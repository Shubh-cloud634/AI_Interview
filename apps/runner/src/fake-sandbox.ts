import { PassThrough } from 'node:stream';
import { SandboxError, type Sandbox, type SandboxOutcome, type SandboxRequest } from './sandbox';
import { supervise, type Supervised } from './supervisor';

/**
 * What a simulated program does. FakeSandbox never executes the source: tests choose a behavior per
 * request, standing in for what a correctly configured kernel sandbox would make that program do.
 * The behaviors drive the real supervisor, so output caps, wall-clock kills and residue checks are
 * the production code paths.
 */
export type FakeBehavior =
  | { kind: 'exit'; code?: number; stdout?: string; stderr?: string; delayMs?: number; memKb?: number }
  /** Reads all of stdin and writes `transform(stdin)` to stdout. */
  | { kind: 'echo'; transform?: (stdin: string) => string }
  /** Never exits on its own: infinite loop or a blocking read. */
  | { kind: 'hang' }
  /** Writes without end. */
  | { kind: 'flood'; stream?: 'stdout' | 'stderr' }
  /** The kernel OOM-kills it. */
  | { kind: 'oom' }
  /** Exits, but leaves a background process running inside the sandbox (daemonize, double fork). */
  | { kind: 'linger'; code?: number };

export interface FakeSandboxOptions {
  /** Simulates a sandbox that cannot be destroyed, to test that the harness fails closed. */
  destroyFails?: boolean;
}

export class FakeSandbox implements Sandbox {
  readonly name = 'fake';
  /** Every request that entered a sandbox, for asserting what never crosses the boundary. */
  readonly requests: SandboxRequest[] = [];
  readonly runs: Supervised[] = [];
  /** Sandboxes created and not yet destroyed. Must be zero between runs. */
  readonly live = new Set<number>();
  private seq = 0;

  constructor(
    private readonly program: (req: SandboxRequest) => FakeBehavior,
    private readonly opts: FakeSandboxOptions = {},
  ) {}

  async preflight() {}

  async run(req: SandboxRequest): Promise<SandboxOutcome> {
    this.requests.push(structuredClone(req));
    const id = ++this.seq;
    this.live.add(id);
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new PassThrough();
    let lingering = 0;
    let finish!: (e: { code: number | null; signal: string | null }) => void;
    const exited = new Promise<{ code: number | null; signal: string | null }>((r) => (finish = r));
    let exitedOnce = false;
    const exit = (code: number | null, signal: string | null = null) => {
      if (exitedOnce) return;
      exitedOnce = true;
      stdout.end();
      stderr.end();
      finish({ code, signal });
    };
    const destroy = async () => {
      if (this.opts.destroyFails) throw new SandboxError('residue', 'sandbox could not be destroyed');
      lingering = 0;
      stdout.destroy();
      stderr.destroy();
      this.live.delete(id);
      exit(null, 'SIGKILL');
    };

    const behavior = this.program(req);
    let memKb: number | null = null;
    let oom = false;
    const timers: NodeJS.Timeout[] = [];
    switch (behavior.kind) {
      case 'exit':
        memKb = behavior.memKb ?? null;
        timers.push(
          setTimeout(() => {
            if (behavior.stdout) stdout.write(behavior.stdout);
            if (behavior.stderr) stderr.write(behavior.stderr);
            exit(behavior.code ?? 0);
          }, behavior.delayMs ?? 0),
        );
        break;
      case 'echo': {
        const parts: Buffer[] = [];
        stdin.on('data', (c: Buffer) => parts.push(c));
        stdin.on('end', () => {
          const input = Buffer.concat(parts).toString('utf8');
          stdout.write((behavior.transform ?? ((s) => s))(input));
          exit(0);
        });
        break;
      }
      case 'hang':
        stdin.resume();
        break;
      case 'flood': {
        const target = behavior.stream === 'stderr' ? stderr : stdout;
        const chunk = Buffer.alloc(64 * 1024, 0x41);
        const pump = () => {
          if (target.destroyed || exitedOnce) return;
          target.write(chunk);
          timers.push(setTimeout(pump, 0));
        };
        pump();
        break;
      }
      case 'oom':
        oom = true;
        timers.push(setTimeout(() => exit(137, null), 1));
        break;
      case 'linger':
        lingering = 1;
        timers.push(setTimeout(() => exit(behavior.code ?? 0), 1));
        break;
    }

    try {
      const s = await supervise({ stdout, stderr, stdin, exited }, {
        stdin: Buffer.from(req.stdin), wallMs: req.limits.wallMs, outputBytes: req.limits.outputBytes, kill: destroy, exitAfterKillMs: 50,
      });
      this.runs.push(s);
      return {
        exitCode: s.exitCode, signal: s.signal, timedOut: s.timedOut, outputLimited: s.outputLimited,
        memoryExceeded: oom, stdout: s.stdout, stderr: s.stderr, wallMs: s.wallMs, memKb,
      };
    } finally {
      for (const t of timers) clearTimeout(t);
      // Like DockerSandbox: the sandbox is destroyed after every run, then verified gone.
      if (this.live.has(id)) await destroy();
      if (this.live.has(id) || lingering > 0) throw new SandboxError('residue', 'sandbox survived the run');
    }
  }
}
