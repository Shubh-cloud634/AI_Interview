# Code Execution: Security Requirements and Review

Status: design review. At the time of writing, `apps/runner` does not exist, so this reviews the design in `docs/architecture.md` section 8 and the brief given to the backend agent. It is not an audit of code. Once the runner exists, every requirement below becomes a check against the real implementation.

**Stance.** Candidate code is malicious. A Docker container shares the host kernel, so a kernel or runtime bug can become a host compromise. Docker with good flags is a reasonable development sandbox and a defense-in-depth layer. It is not sufficient isolation for production on its own.

## 1. Assets and attackers

| Asset | Why it matters |
|---|---|
| API secrets, DB credentials, AI keys, JWT signing material | Full compromise |
| Other candidates' code, resumes, reports | Privacy breach |
| Hidden test cases and expected outputs | Cheating, product integrity |
| Runner host and its network position | Pivot into internal services |
| Compute budget | Cost and denial of service |

Attackers: a candidate trying to read hidden tests or inflate a score, a candidate trying to escape, a candidate trying to exhaust capacity, and a malicious pack author (hostile test case content or starter code).

## 2. Findings in the current design and the fixes

| # | Finding | Severity | Fix |
|---|---|---|---|
| F1 | The Docker dev adapter needs access to a container runtime. A process that can talk to the Docker daemon (or mount `docker.sock`) is root-equivalent on the host. A runner compromise becomes a host compromise. | High | Never mount `docker.sock` into any container. Prefer rootless Docker or rootless Podman for the dev adapter, with the runner as an unprivileged user. In production, replace with gVisor (`runsc`) or Firecracker microVMs behind the `Sandbox` interface. |
| F2 | Shared host kernel in the Docker adapter. Kernel and runc vulnerabilities have produced real container escapes. | High | Production requires a stronger boundary: microVM (Firecracker or Cloud Hypervisor) preferred, gVisor acceptable when a userspace kernel boundary is enough. Keep the host kernel patched. Do not run the Docker adapter on any host that holds secrets or can reach internal services. |
| F3 | The runner holds the result-signing key. A compromised runner can forge results for any job it can see. | Medium | One key per runner instance, rotated, revocable. Bind each signature to `(job_id, lease_id, runner_id, source_sha256, nonce)`. The API accepts a result only for a job currently leased to that runner and only once. Anomaly alerts on runner-reported score distributions. |
| F4 | Hidden tests and expected outputs live on the runner host (the trusted harness needs them). Runner compromise exposes them. | Medium | Keep them out of the sandbox container and VM entirely. Accept the residual risk but limit it: the runner fetches only the tests for the job it holds, with a short-lived token, never the whole bank. Rotate problems if a runner is ever suspected compromised. |
| F5 | The compile step is attack surface. Compilers and build tools can read files, run plugins, and consume unbounded resources (template bombs, include bombs). | Medium | Compile inside the same class of sandbox, with its own limits, no network, no host mounts. Disallow build-time includes of absolute host paths via the empty rootfs. Never compile on the runner host directly. |
| F6 | stdout, stderr and compiler messages are attacker-controlled text. They reach the browser, possibly an LLM, and logs. | Medium | Treat as untrusted data everywhere: truncate, strip control characters and ANSI sequences, render as text only in the UI, wrap in delimited data blocks before any LLM use, and redact paths. Never put sandbox output in HTML, markdown, or log formats without escaping. |
| F7 | Scheduler to runner trust. If any caller can lease jobs, an attacker gets source code of other candidates. | Medium | Runner authenticates with mTLS or signed short-lived tokens. Scheduler leases only to registered runners. Leases expire. No API endpoint reachable by candidates can lease jobs. |
| F8 | Queue abuse. Many submissions or poison jobs can starve capacity for others. | Medium | Per-user and per-IP submission rate limits, per-user concurrency of one active run, global and per-user queue depth caps, job TTL and max attempts, dead-letter after repeated runner failure. |
| F9 | Cross-run leakage through reused containers, shared tmpfs, caches, or leftover processes. | High | Fresh VM or container per run, destroyed after, with no shared volumes and no reuse across users. Verify no process survives the wall-clock kill (kill the whole cgroup or VM, not the entry process). |
| F10 | Pack authors can submit hostile test input or harness-affecting content. | Low to medium | Validate test cases against size limits at publish. Harness treats test data as bytes, never code. Authoring requires the `pack_author` role plus review before publish. |

## 3. Concrete requirements

Each is testable. "Must" means release-blocking.

### Isolation
- S1. Production execution must use a hardware- or userspace-kernel-isolated sandbox (microVM or gVisor). A shared-kernel container alone must not be used in production.
- S2. Each run must use a fresh sandbox, destroyed after the run, never reused across runs or users.
- S3. The sandbox must contain no host filesystem mounts, no `docker.sock`, no cloud metadata access, and no runner credentials.
- S4. The runner process must run as an unprivileged user on a dedicated host or node pool that holds no application secrets and has no route to the API database or internal services.

### Privileges
- S5. Candidate code must run as a non-root user with a dedicated unprivileged UID, `no_new_privs` set, all capabilities dropped, and a seccomp allowlist (not the permissive default). Block at least `ptrace`, `mount`, `unshare`, `setns`, `keyctl`, `bpf`, `perf_event_open`, `userfaultfd`, `kexec`, `module` syscalls, and raw sockets.
- S6. Root filesystem must be read-only. The only writable location is a size-capped tmpfs working directory with `noexec` where the language allows it and `nosuid,nodev` always.
- S7. No device nodes beyond the minimal set. `/proc` and `/sys` must be masked or minimal. Language runtime images are pinned by digest, built from a minimal base, and scanned.

### Network
- S8. The sandbox must have no network interface. The host must also drop egress from the runner network segment to RFC1918 ranges, link-local (including `169.254.169.254`), and internal services, with only the outbound scheduler connection allowed.

### Resource limits (enforced by cgroup v2 or VM config, not by the candidate's process)
- S9. CPU: quota (for example one core) and a CPU-time limit. Wall-clock limit enforced by the supervisor with a hard kill of the whole sandbox.
- S10. Memory: hard limit with swap disabled, OOM kill reported as `memory_limit`.
- S11. Processes: `pids.max` low (for example 64) so fork bombs fail fast. Open files `nofile` capped. No new threads beyond the limit.
- S12. Disk: tmpfs size cap and inode cap. File size `fsize` cap.
- S13. Input and output: stdin size cap per test. Stdout and stderr read through bounded buffers; exceeding the cap kills the run with `output_limit` without buffering the excess. Source size capped at 64 KB (already in the contract).
- S14. Infinite loops and blocking reads: covered by wall-clock kill. A run must always terminate within `timeLimit + grace`, verified by test.

### Harness and integrity
- S15. The harness must run outside the sandbox. It feeds inputs and compares outputs. Expected outputs and hidden test names must never enter the sandbox or any candidate-visible response or log.
- S16. Result messages must be signed per F3, verified by the API, and accepted once per lease.
- S17. The API process must never execute candidate code, import `child_process`, `vm` or `worker_threads` for submission handling, or hold a container runtime credential. Enforce with a CI lint.

### Abuse controls
- S18. Submission and run endpoints must be rate limited per user and per IP, with one active run per user and bounded queue depth. Exceeding returns `429` with `retry-after`.
- S19. Server-authoritative deadline: reject runs and submissions after the stage deadline plus grace.
- S20. Alert on spikes in timeouts, OOMs, killed-by-seccomp events, runner heartbeat loss, and abnormal pass-rate by runner.

### Errors and logging
- S21. Compiler and runtime errors are returned only as sanitized, truncated text (F6). Host paths, image names, kernel messages and stack frames from the supervisor are never exposed.
- S22. Logs record job id, language, limits hit, durations and exit status. They must not contain source code, test data or sandbox output by default.

## 4. Docker dev adapter: minimum flags

For development only, never for untrusted production traffic:

```
docker run --rm --network none --read-only \
  --user 65534:65534 --cap-drop ALL --security-opt no-new-privileges \
  --security-opt seccomp=<custom-allowlist.json> \
  --pids-limit 64 --memory 256m --memory-swap 256m --cpus 1 \
  --ulimit nofile=64 --ulimit fsize=10485760 --ulimit core=0 \
  --tmpfs /work:rw,noexec,nosuid,nodev,size=16m,mode=1777 \
  --stop-timeout 0 <image@sha256:digest>
```

Plus a supervisor kill at the wall-clock limit followed by `docker rm -f` and verification that the container is gone. Run under rootless Docker or Podman. No bind mounts.

## 5. Recommended production architecture

- Runner fleet on dedicated hosts or a dedicated node pool in an isolated network segment with egress allowlisted to the scheduler only.
- Per-run Firecracker microVM (or gVisor sandbox) booted from a pinned read-only image, with a warm pool to cut latency. Pool entries are single-use.
- Short-lived per-job credentials, per-runner signing keys, mTLS to the scheduler.
- Host kernel patching cadence and an image scan and rebuild pipeline.
- Defense in depth: even with a microVM, keep seccomp, non-root, no network, and cgroup limits inside it.

## 6. Verification plan

An escape-and-abuse test suite of hostile programs, run in CI against the dev adapter and against production sandbox in staging. Each must end with the expected status and no residue:

1. Fork bomb in each language: ends with a limit status, host process count unchanged.
2. Infinite loop and blocking read: killed at the wall-clock limit.
3. Memory hog and allocation loop: `memory_limit`, host unaffected.
4. Huge stdout/stderr: `output_limit`, supervisor memory flat.
5. Disk fill and inode exhaustion in `/work`: bounded.
6. Network attempts (TCP, UDP, DNS, metadata IP): all fail.
7. Reads of `/proc/*`, `/sys`, `/etc`, environment variables, host paths, `docker.sock`, runner env: nothing sensitive visible.
8. Attempts to `ptrace`, `mount`, `unshare`, create raw sockets, load BPF: denied by seccomp.
9. Symlink and `..` traversal out of `/work`: contained.
10. Process left behind after exit (daemonize, double fork): none survive the run.
11. Output containing ANSI codes, HTML, markdown, and prompt-injection text: arrives sanitized and inert in the UI and in any LLM input.
12. Replay or forgery of a result message with wrong lease, runner or hash: rejected.
13. Hidden test names and expected outputs absent from every API response and log line.

Plus a dependency and image scan on every runner image build, and a periodic external review before opening to the public.

## 7. Not yet verified

No sandbox code exists, so nothing above has been run or confirmed against an implementation. No claim here depends on Docker alone for safety. The residual risk after all controls is a kernel or hypervisor vulnerability, which is why S1 and S4 require a stronger boundary and a host with nothing worth stealing.
