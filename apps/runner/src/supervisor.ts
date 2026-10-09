import type { Readable, Writable } from 'node:stream';

/** A started sandbox process as the supervisor sees it: three pipes and an exit. */
export interface SupervisedProcess {
  stdout: Readable;
  stderr: Readable;
  stdin: Writable;
  exited: Promise<{ code: number | null; signal: string | null }>;
}

export interface SuperviseOptions {
  stdin: Buffer;
  /** Hard wall clock from start. */
  wallMs: number;
  /** stdout + stderr combined; reaching it kills the run. */
  outputBytes: number;
  /** Destroys the whole sandbox (not just the entry process) and resolves once that is verified. */
  kill: () => Promise<void>;
  /** After a kill, how long to wait for the process handle to report exit before returning anyway. */
  exitAfterKillMs?: number;
}

export interface Supervised {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  outputLimited: boolean;
  killed: boolean;
  stdout: string;
  stderr: string;
  wallMs: number;
  /** Bytes actually held in memory for output. Never above outputBytes (S13: no buffering of the excess). */
  bufferedBytes: number;
}

/**
 * Runs one sandboxed process to completion under the supervisor's limits. Output is read through a
 * bounded buffer: at the cap, the excess is dropped, the streams are destroyed and the sandbox is
 * killed. At the wall clock the sandbox is killed. Every path ends with the process gone.
 */
export async function supervise(p: SupervisedProcess, opts: SuperviseOptions): Promise<Supervised> {
  const started = Date.now();
  const chunks = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
  let total = 0;
  let timedOut = false;
  let outputLimited = false;
  let killing: Promise<void> | null = null;
  // Settles once a kill finishes: rejects if the sandbox could not be destroyed, otherwise resolves
  // after a grace period, so the wait below never hangs on a process handle that does not report exit.
  let settleKill!: { ok: () => void; fail: (err: unknown) => void };
  const killSettled = new Promise<{ code: null; signal: 'SIGKILL' }>((resolve, reject) => {
    settleKill = { ok: () => void delay(opts.exitAfterKillMs ?? 5_000).then(() => resolve({ code: null, signal: 'SIGKILL' })), fail: reject };
  });
  killSettled.catch(() => {});

  const kill = () =>
    (killing ??= opts.kill().then(settleKill.ok, (err) => {
      settleKill.fail(err);
      throw err;
    }));

  const take = (name: 'stdout' | 'stderr') => (chunk: Buffer | string) => {
    if (outputLimited) return;
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    const room = opts.outputBytes - total;
    if (buf.length > room) {
      if (room > 0) chunks[name].push(buf.subarray(0, room));
      total = opts.outputBytes;
      outputLimited = true;
      p.stdout.destroy();
      p.stderr.destroy();
      void kill().catch(() => {});
      return;
    }
    chunks[name].push(buf);
    total += buf.length;
  };
  p.stdout.on('data', take('stdout'));
  p.stderr.on('data', take('stderr'));
  p.stdout.on('error', () => {});
  p.stderr.on('error', () => {});

  // The program may never read stdin or may exit early; a broken pipe is not an error.
  p.stdin.on('error', () => {});
  p.stdin.end(opts.stdin);

  const timer = setTimeout(() => {
    timedOut = true;
    void kill().catch(() => {});
  }, opts.wallMs);

  let exit: { code: number | null; signal: string | null } = { code: null, signal: null };
  try {
    exit = await Promise.race([p.exited, killSettled]);
  } finally {
    clearTimeout(timer);
  }
  // A kill that started (for example, the cap hit just as the process exited) must finish and be
  // verified before the run counts as over.
  if (killing) await killing;

  const decode = (bs: Buffer[]) => Buffer.concat(bs).toString('utf8');
  return {
    exitCode: exit.code,
    signal: exit.signal,
    timedOut,
    outputLimited,
    killed: killing !== null,
    stdout: decode(chunks.stdout),
    stderr: decode(chunks.stderr),
    wallMs: Date.now() - started,
    bufferedBytes: total,
  };
}

export const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
