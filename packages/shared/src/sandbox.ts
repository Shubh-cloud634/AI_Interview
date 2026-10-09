import { z } from 'zod';
import { RunStatus, RunSuite } from './enums';
import { ExecLimits } from './spec';

/**
 * Scheduler <-> runner contract. The runner is a separate deployable with no DB or API credentials:
 * it leases one job at a time, runs it through its Sandbox, and returns a result signed with its own
 * Ed25519 key. Nothing here is served to candidates.
 */

export const RunnerTest = z.object({
  /** Opaque per-lease id, so hidden test names never reach the runner either. */
  id: z.string(),
  input: z.string(),
  expected: z.string(),
  weight: z.number(),
  hidden: z.boolean(),
  timeLimitMs: z.int().nullable(),
});
export type RunnerTest = z.infer<typeof RunnerTest>;

export const LeasedJob = z.object({
  jobId: z.uuid(),
  leaseId: z.uuid(),
  nonce: z.string(),
  leaseExpiresAt: z.iso.datetime({ offset: true }),
  suite: RunSuite,
  language: z.object({
    slug: z.string(),
    imageRef: z.string(),
    compileCmd: z.string().nullable(),
    runCmd: z.string(),
    limits: ExecLimits,
  }),
  source: z.string(),
  sourceSha256: z.string(),
  tests: z.array(RunnerTest),
});
export type LeasedJob = z.infer<typeof LeasedJob>;

export const LeaseResponse = z.object({ job: LeasedJob.nullable() });
export type LeaseResponse = z.infer<typeof LeaseResponse>;

export const RunnerTestResult = z.object({
  id: z.string(),
  status: RunStatus,
  passed: z.boolean(),
  timeMs: z.number().min(0),
  memKb: z.number().min(0),
});
export type RunnerTestResult = z.infer<typeof RunnerTestResult>;

export const RunnerResult = z.object({
  jobId: z.uuid(),
  leaseId: z.uuid(),
  runnerId: z.uuid(),
  nonce: z.string(),
  sourceSha256: z.string(),
  status: RunStatus,
  perTest: z.array(RunnerTestResult),
  /** Sanitized and truncated; only from visible tests. Still untrusted. */
  stdout: z.string().max(8192),
  stderr: z.string().max(8192),
});
export type RunnerResult = z.infer<typeof RunnerResult>;

export const SignedRunnerResult = z.object({ result: RunnerResult, signature: z.string() });
export type SignedRunnerResult = z.infer<typeof SignedRunnerResult>;

/** Bytes both sides sign/verify. Fixed field order; binds job, lease, runner, source and nonce. */
export function canonicalResult(r: RunnerResult): string {
  return JSON.stringify([
    'run-result.v1',
    r.jobId,
    r.leaseId,
    r.runnerId,
    r.sourceSha256,
    r.nonce,
    r.status,
    r.perTest.map((t) => [t.id, t.status, t.passed, t.timeMs, t.memKb]),
    r.stdout,
    r.stderr,
  ]);
}

export type RunnerRequestPurpose = 'lease' | 'heartbeat';

/**
 * Bytes a runner signs to authenticate a scheduler request. Binds the purpose and the request's
 * fields, so a signature for one heartbeat cannot be reused for another job or for a lease. The
 * timestamp must strictly increase per runner; the API rejects anything not newer than the last.
 */
export const canonicalRunnerRequest = (purpose: RunnerRequestPurpose, runnerId: string, timestampMs: number, fields: string[] = []) =>
  JSON.stringify(['runner-request.v1', purpose, runnerId, timestampMs, ...fields]);

export const RUNNER_ID_HEADER = 'x-runner-id';
export const RUNNER_TS_HEADER = 'x-runner-timestamp';
export const RUNNER_SIG_HEADER = 'x-runner-signature';
/** `authorization: Runner <credential>`: the per-runner bearer credential, checked before signatures. */
export const RUNNER_AUTH_SCHEME = 'Runner';

/** Extends the lease while a job is executing. Signed with fields [jobId, leaseId]. */
export const HeartbeatRequest = z.object({ jobId: z.uuid(), leaseId: z.uuid() });
export type HeartbeatRequest = z.infer<typeof HeartbeatRequest>;
/** cancel: the lease is gone (expired, reclaimed or capped); stop work and do not submit. */
export const HeartbeatResponse = z.object({ leaseExpiresAt: z.iso.datetime({ offset: true }).nullable(), cancel: z.boolean() });
export type HeartbeatResponse = z.infer<typeof HeartbeatResponse>;

export const MAX_OUTPUT_CHARS = 4096;

/**
 * Sandbox output is attacker-controlled (F6, S21). Strip ANSI/OSC sequences, control characters,
 * bidi overrides and zero-width characters, normalize newlines, redact absolute paths, and truncate.
 * Applied by the runner and again by the API before storing. The result is still untrusted text:
 * render it escaped and wrap it as data before any LLM use.
 */
export function sanitizeOutput(text: string, maxChars = MAX_OUTPUT_CHARS): string {
  const cleaned = text
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)?|\u001b[@-_]?|\u009b[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
    .replace(/[​-‏‪-‮⁠-⁩﻿]/g, '')
    .replace(/[A-Za-z]:\\(?:[^\\\s"'<>|]+\\)*[^\\\s"'<>|]*/g, '<path>')
    .replace(/(?:\/[\w.@+-]+){2,}\/?/g, '<path>');
  if (cleaned.length <= maxChars) return cleaned;
  // Do not cut a surrogate pair in half.
  const end = /[\ud800-\udbff]/.test(cleaned[maxChars - 1] ?? '') ? maxChars - 1 : maxChars;
  return `${cleaned.slice(0, end)}\n[truncated]`;
}
