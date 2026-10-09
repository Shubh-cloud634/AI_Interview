/**
 * The isolation boundary. Every adapter (FakeSandbox for tests, DockerSandbox for development, a
 * gVisor or Firecracker adapter for production) implements this interface. The harness never runs
 * candidate code itself and never learns how isolation is achieved.
 *
 * What crosses into a sandbox is exactly a SandboxRequest: the image, the command, the candidate's
 * source and one test's stdin. There is no field for expected output, test names or the test list,
 * so they cannot enter by construction (S15).
 */

export type SandboxPhase = 'compile' | 'run';

export interface SandboxLimits {
  /** Wall clock for the program, enforced by the supervisor with a hard kill of the whole sandbox (S9, S14). */
  wallMs: number;
  /** CPU time (RLIMIT_CPU or equivalent). */
  cpuMs: number;
  memoryMb: number;
  pids: number;
  /** stdout + stderr combined. Exceeding it kills the run (S13). */
  outputBytes: number;
}

export interface SandboxRequest {
  phase: SandboxPhase;
  /** Pinned language image (`name@sha256:...` in production). */
  image: string;
  /** argv, never passed through a shell. */
  command: string[];
  /** File name inside the writable work dir, e.g. `main.py`. */
  sourceFile: string;
  source: string;
  stdin: string;
  limits: SandboxLimits;
}

export interface SandboxOutcome {
  exitCode: number | null;
  signal: string | null;
  /** Killed by the supervisor at the wall-clock limit. */
  timedOut: boolean;
  /** Killed by the supervisor when output reached limits.outputBytes. */
  outputLimited: boolean;
  /** The sandbox reported an OOM kill (or the adapter inferred one). */
  memoryExceeded: boolean;
  /** Raw, bounded, attacker-controlled. Sanitize before it goes anywhere. */
  stdout: string;
  stderr: string;
  wallMs: number;
  /** Peak memory when the adapter can measure it, else null. */
  memKb: number | null;
}

/** The sandbox itself failed (could not start, or could not be verified destroyed). Not the candidate's fault. */
export class SandboxError extends Error {
  constructor(
    readonly reason: 'start_failed' | 'residue' | 'unavailable' | 'bad_request',
    message: string,
  ) {
    super(message);
  }
}

export interface Sandbox {
  readonly name: string;
  /** Fails closed when the adapter's isolation preconditions do not hold. */
  preflight(): Promise<void>;
  /** One fresh sandbox per call, destroyed and verified gone before it returns (S2, F9). */
  run(req: SandboxRequest): Promise<SandboxOutcome>;
}
