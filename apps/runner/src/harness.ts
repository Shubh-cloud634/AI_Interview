import { MAX_OUTPUT_CHARS, sanitizeOutput, type LeasedJob, type RunStatus, type RunnerResult, type RunnerTestResult } from '@ai-interview/shared';
import { SandboxError, type Sandbox, type SandboxLimits, type SandboxOutcome, type SandboxPhase } from './sandbox';

/**
 * The trusted harness. Runs OUTSIDE the sandbox: it starts one sandbox for the compile step and one
 * per test, feeds each test's input over stdin, and compares stdout with the expected output itself.
 * Expected outputs, test names and the test list never enter a sandbox (S15). Output returned to the
 * API comes only from the compile step and visible tests, sanitized (F6), so a program cannot echo
 * hidden inputs back to the candidate.
 */

export const HARNESS_LIMITS = {
  /** Stops starting new tests once a job has used this much wall time; the rest count as timeouts. */
  jobBudgetMs: 300_000,
  /** Largest stdin the harness will feed to one test. */
  maxStdinBytes: 1_048_576,
  /** Compile gets the language limits but at least this long. */
  minCompileWallMs: 10_000,
} as const;

export type HarnessResult = Pick<RunnerResult, 'status' | 'perTest' | 'stdout' | 'stderr'>;

/** Whitespace-tolerant comparison: CRLF, trailing spaces per line and trailing blank lines do not matter. */
export function outputsMatch(actual: string, expected: string): boolean {
  const norm = (s: string) => s.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n').replace(/\n+$/, '');
  return norm(actual) === norm(expected);
}

const MEMORY_MESSAGES = /\bMemoryError\b|JavaScript heap out of memory|Cannot allocate memory|std::bad_alloc/;

/** Maps one sandbox outcome to a status. Supervisor facts first; the program's own text last. */
export function classify(o: SandboxOutcome, phase: SandboxPhase): RunStatus | 'ok' {
  if (o.timedOut) return 'timeout';
  if (o.outputLimited) return 'output_limit';
  if (o.memoryExceeded || o.exitCode === 137 || MEMORY_MESSAGES.test(o.stderr)) return 'memory_limit';
  // SIGXCPU: the CPU-time rlimit fired.
  if (o.exitCode === 152 || o.signal === 'SIGXCPU') return 'timeout';
  if (o.exitCode !== 0) return phase === 'compile' ? 'compile_error' : 'runtime_error';
  return 'ok';
}

/** Worst first. The overall status of a failing run is its most severe per-test status. */
const SEVERITY: RunStatus[] = ['internal_error', 'timeout', 'memory_limit', 'output_limit', 'runtime_error', 'compile_error', 'failed'];

export function overallStatus(perTest: RunnerTestResult[]): RunStatus {
  if (perTest.every((t) => t.passed)) return 'passed';
  return SEVERITY.find((s) => perTest.some((t) => t.status === s)) ?? 'failed';
}

/** The work-dir file the run command expects (`python3 -I main.py` -> `main.py`). */
export function sourceFileOf(cmd: string): string {
  const f = cmd.split(/\s+/).find((t) => /^main\.[a-z0-9]{1,8}$/.test(t));
  if (!f) throw new SandboxError('bad_request', 'run command does not name a main.<ext> source file');
  return f;
}

export const argv = (cmd: string) => cmd.trim().split(/\s+/).filter(Boolean);

const textOf = (o: Pick<SandboxOutcome, 'stdout' | 'stderr'>) => ({
  stdout: sanitizeOutput(o.stdout, MAX_OUTPUT_CHARS),
  stderr: sanitizeOutput(o.stderr, MAX_OUTPUT_CHARS),
});

export async function runJob(job: LeasedJob, sandbox: Sandbox, signal?: AbortSignal): Promise<HarnessResult> {
  const { language } = job;
  const limits: SandboxLimits = {
    wallMs: language.limits.wallMs, cpuMs: language.limits.cpuMs, memoryMb: language.limits.memoryMb,
    pids: language.limits.pids, outputBytes: language.limits.outputBytes,
  };
  const sourceFile = sourceFileOf(language.runCmd);
  const base = { image: language.imageRef, sourceFile, source: job.source };

  if (language.compileCmd) {
    const compileLimits = { ...limits, wallMs: Math.max(limits.wallMs, HARNESS_LIMITS.minCompileWallMs) };
    const o = await sandbox.run({ ...base, phase: 'compile', command: argv(language.compileCmd), stdin: '', limits: compileLimits });
    const c = classify(o, 'compile');
    // No test runs when the compile step fails or hits a limit; each test carries that status.
    if (c !== 'ok') return { status: c, perTest: job.tests.map((t) => ({ id: t.id, status: c, passed: false, timeMs: 0, memKb: 0 })), ...textOf(o) };
  }

  const started = Date.now();
  const perTest: RunnerTestResult[] = [];
  let shown: { stdout: string; stderr: string; failing: boolean } | null = null;
  for (const test of job.tests) {
    if (signal?.aborted) throw new Error('lease cancelled');
    if (Date.now() - started > HARNESS_LIMITS.jobBudgetMs) {
      perTest.push({ id: test.id, status: 'timeout', passed: false, timeMs: 0, memKb: 0 });
      continue;
    }
    if (Buffer.byteLength(test.input) > HARNESS_LIMITS.maxStdinBytes) throw new SandboxError('bad_request', 'test input exceeds the stdin cap');
    const o = await sandbox.run({
      ...base, phase: 'run', command: argv(language.runCmd), stdin: test.input,
      limits: { ...limits, wallMs: test.timeLimitMs ?? limits.wallMs },
    });
    const c = classify(o, 'run');
    // The comparison happens here, outside the sandbox.
    const status: RunStatus = c === 'ok' ? (outputsMatch(o.stdout, test.expected) ? 'passed' : 'failed') : c;
    perTest.push({ id: test.id, status, passed: status === 'passed', timeMs: Math.round(o.wallMs), memKb: Math.round(o.memKb ?? 0) });
    // Show the first failing visible test, else the first visible test. Never a hidden one.
    if (!test.hidden && (!shown || (!shown.failing && status !== 'passed'))) shown = { ...textOf(o), failing: status !== 'passed' };
  }
  return { status: overallStatus(perTest), perTest, stdout: shown?.stdout ?? '', stderr: shown?.stderr ?? '' };
}

/** When the harness itself fails, every leased test is reported so the API can retry or dead-letter. */
export function internalError(job: LeasedJob): HarnessResult {
  return {
    status: 'internal_error',
    perTest: job.tests.map((t) => ({ id: t.id, status: 'internal_error', passed: false, timeMs: 0, memKb: 0 })),
    stdout: '',
    stderr: '',
  };
}
