import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SandboxError, type Sandbox, type SandboxOutcome, type SandboxRequest } from './sandbox';
import { delay, supervise } from './supervisor';

/**
 * DEVELOPMENT ONLY. A shared-kernel container is not production isolation (docs/sandbox-security.md
 * F2, S1). Production uses gVisor or Firecracker behind the same Sandbox interface. Run this under
 * rootless Docker or Podman as an unprivileged user (F1); never mount docker.sock anywhere.
 *
 * Every run is a fresh `docker run --rm` container with the flags from sandbox-security.md section 4,
 * killed by the supervisor at the wall clock or output cap with `docker rm -f`, then verified gone.
 */

export interface DockerSandboxOptions {
  /** Path to the custom seccomp allowlist (apps/runner/seccomp/runner-seccomp.json). */
  seccompProfile: string;
  /** `runsc` to run under gVisor through Docker. Unset: the default runtime (dev only). */
  runtime?: string;
  /** Allow a rootful daemon. Dev convenience only; rootless is the requirement (F1). */
  allowRootful?: boolean;
  /** Container start overhead allowed on top of the program's wall limit. */
  startupAllowanceMs?: number;
  dockerBin?: string;
  production?: boolean;
}

const WORK_TMPFS = '/work:rw,noexec,nosuid,nodev,size=16m,nr_inodes=4096,mode=1777';
const FSIZE_BYTES = 10_485_760;
const SANDBOX_UID = '65534:65534';
const LABEL = 'ai-interview.sandbox';

/** The exact argv for one sandboxed run. Pure, so tests can assert every flag without Docker. */
export function dockerRunArgs(req: SandboxRequest, o: { name: string; instance: string; seccompProfile: string; runtime?: string }): string[] {
  const cpuSeconds = Math.max(1, Math.ceil(req.limits.cpuMs / 1000));
  return [
    'run', '--rm', '--interactive',
    '--name', o.name, '--label', `${LABEL}=${o.instance}`,
    '--pull', 'never',
    ...(o.runtime ? ['--runtime', o.runtime] : []),
    '--network', 'none',
    '--read-only',
    '--user', SANDBOX_UID,
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--security-opt', `seccomp=${o.seccompProfile}`,
    '--pids-limit', String(req.limits.pids),
    '--memory', `${req.limits.memoryMb}m`,
    '--memory-swap', `${req.limits.memoryMb}m`,
    '--cpus', '1',
    '--ulimit', 'nofile=64',
    '--ulimit', `fsize=${FSIZE_BYTES}`,
    '--ulimit', 'core=0',
    '--ulimit', `cpu=${cpuSeconds}`,
    '--tmpfs', WORK_TMPFS,
    '--ipc', 'none',
    '--hostname', 'sandbox',
    '--workdir', '/work',
    '--env', 'HOME=/work',
    '--env', 'TMPDIR=/work',
    '--stop-timeout', '0',
    req.image,
    ...req.command,
  ];
}

/** stdin for the image's launcher: `<bytes> <file>\n`, the source, then the test input. */
export function framedStdin(req: SandboxRequest): Buffer {
  const source = Buffer.from(req.source, 'utf8');
  return Buffer.concat([Buffer.from(`${source.length} ${req.sourceFile}\n`), source, Buffer.from(req.stdin, 'utf8')]);
}

/** Only what the docker CLI needs. Runner credentials never reach a child process. */
function cliEnv(): NodeJS.ProcessEnv {
  const keep = ['PATH', 'HOME', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'XDG_RUNTIME_DIR', 'SYSTEMROOT', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ProgramData'];
  return Object.fromEntries(keep.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
}

const DOCKER_CLI_ERROR = /^docker: |Error response from daemon|Unable to find image|Cannot connect to the Docker daemon/m;

export class DockerSandbox implements Sandbox {
  readonly name: string;
  private readonly instance = randomBytes(6).toString('hex');
  private readonly active = new Set<string>();
  private readonly bin: string;

  constructor(private readonly opts: DockerSandboxOptions) {
    this.name = opts.runtime ? `docker+${opts.runtime}` : 'docker';
    this.bin = opts.dockerBin ?? 'docker';
  }

  private exec(args: string[], timeoutMs = 10_000): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const p = spawn(this.bin, args, { env: cliEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      p.stdout.on('data', (c) => (stdout += c));
      p.stderr.on('data', (c) => (stderr += c));
      const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
      p.on('error', (e) => {
        clearTimeout(t);
        resolve({ code: null, stdout, stderr: String(e) });
      });
      p.on('close', (code) => {
        clearTimeout(t);
        resolve({ code, stdout, stderr });
      });
    });
  }

  async preflight(): Promise<void> {
    if (this.opts.production && this.opts.runtime !== 'runsc') {
      throw new SandboxError('unavailable', 'the plain Docker adapter is development-only (S1); use gVisor or Firecracker in production');
    }
    const profile = JSON.parse(readFileSync(this.opts.seccompProfile, 'utf8')) as { defaultAction?: string };
    if (profile.defaultAction !== 'SCMP_ACT_ERRNO') throw new SandboxError('unavailable', 'seccomp profile must be an allowlist (defaultAction SCMP_ACT_ERRNO)');
    const v = await this.exec(['version', '--format', '{{.Server.Version}}']);
    if (v.code !== 0) throw new SandboxError('unavailable', 'docker daemon not reachable');
    const info = await this.exec(['info', '--format', '{{json .SecurityOptions}} {{json .Runtimes}}']);
    if (info.code !== 0) throw new SandboxError('unavailable', 'docker info failed');
    if (!this.opts.allowRootful && !/rootless/.test(info.stdout)) {
      throw new SandboxError('unavailable', 'docker daemon is not rootless (F1); set RUNNER_ALLOW_ROOTFUL_DOCKER=1 only on a disposable dev machine');
    }
    if (this.opts.runtime && !info.stdout.includes(`"${this.opts.runtime}"`)) {
      throw new SandboxError('unavailable', `docker runtime ${this.opts.runtime} is not registered`);
    }
    await this.sweep();
  }

  /** Removes containers this runner process created that are not part of a live run (F9). */
  async sweep(): Promise<void> {
    const ls = await this.exec(['ps', '-a', '--filter', `label=${LABEL}=${this.instance}`, '--format', '{{.Names}}']);
    const stale = ls.stdout.split(/\s+/).filter((n) => n && !this.active.has(n));
    for (const n of stale) await this.destroy(n);
  }

  /** `docker rm -f`, then verify the container no longer exists. Throws if it survives. */
  async destroy(name: string): Promise<void> {
    for (let i = 0; i < 5; i++) {
      await this.exec(['rm', '-f', name]);
      const inspect = await this.exec(['container', 'inspect', '--format', '{{.State.Status}}', name]);
      if (inspect.code !== 0 && /no such (container|object)/i.test(inspect.stderr)) return;
      await delay(200 * (i + 1));
    }
    throw new SandboxError('residue', 'sandbox container could not be verified destroyed');
  }

  async run(req: SandboxRequest): Promise<SandboxOutcome> {
    const name = `ai-run-${this.instance}-${randomBytes(6).toString('hex')}`;
    const args = dockerRunArgs(req, { name, instance: this.instance, seccompProfile: this.opts.seccompProfile, runtime: this.opts.runtime });
    this.active.add(name);
    const child = spawn(this.bin, args, { env: cliEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      child.on('error', () => resolve({ code: null, signal: null }));
      child.on('close', (code, signal) => resolve({ code, signal }));
    });
    try {
      const s = await supervise({ stdout: child.stdout, stderr: child.stderr, stdin: child.stdin, exited }, {
        stdin: framedStdin(req),
        wallMs: req.limits.wallMs + (this.opts.startupAllowanceMs ?? 3_000),
        outputBytes: req.limits.outputBytes,
        // Kill the whole container (its cgroup), not the CLI process: killing the CLI leaves it running.
        kill: () => this.destroy(name),
      });
      if (!s.killed && s.exitCode === 125 && DOCKER_CLI_ERROR.test(s.stderr)) throw new SandboxError('start_failed', 'docker could not start the sandbox');
      return {
        exitCode: s.exitCode, signal: s.signal, timedOut: s.timedOut, outputLimited: s.outputLimited,
        // --rm removes the container before it can be inspected; 137 without a supervisor kill is the OOM killer.
        memoryExceeded: !s.killed && s.exitCode === 137,
        stdout: s.stdout, stderr: s.stderr, wallMs: s.wallMs, memKb: null,
      };
    } finally {
      child.kill('SIGKILL');
      // Always verify, also after a normal exit: --rm is asynchronous and a killed CLI leaves the container.
      try {
        await this.destroy(name);
      } finally {
        this.active.delete(name);
      }
    }
  }
}
