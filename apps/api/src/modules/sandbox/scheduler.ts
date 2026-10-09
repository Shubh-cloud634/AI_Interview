import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify, type KeyObject } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ExecLimits,
  HeartbeatRequest,
  RUNNER_AUTH_SCHEME,
  RUNNER_ID_HEADER,
  RUNNER_SIG_HEADER,
  RUNNER_TS_HEADER,
  SignedRunnerResult,
  canonicalResult,
  canonicalRunnerRequest,
  sanitizeOutput,
  type HeartbeatResponse,
  type LeaseResponse,
  type LeasedJob,
  type RunSuite,
  type RunnerRequestPurpose,
  type RunnerResult,
  type RunnerTest,
} from '@ai-interview/shared';
import type { Db } from '../../db/db';
import { iso } from '../../db/db';
import { AppError, unauthorized, validationError } from '../../http/errors';
import { getLanguage, questionBody } from '../catalog/catalog';
import { testsForSuite, type StoredTest } from '../coding/problem';

/**
 * Scheduler contract (docs/sandbox-security.md F3, F7, F8, S16). Runners authenticate with a
 * per-runner bearer credential plus an Ed25519 signature over a strictly increasing timestamp, so
 * neither a leaked credential alone nor a captured request is enough. Results are signed over
 * (job_id, lease_id, runner_id, source_sha256, nonce, outcome) and accepted once, for the live lease only.
 */

export const SCHEDULER_LIMITS = {
  leaseSeconds: 120,
  /** Heartbeats extend a lease up to this long after it was granted, never longer. */
  maxLeaseSeconds: 600,
  clockSkewMs: 60_000,
  queuedTtlMinutes: 15,
} as const;

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const conflict = (detail: string) => new AppError(409, 'conflict', 'Conflict', detail);
const AUTH_FAILED = 'runner authentication failed';

interface RunnerRow {
  public_key: string;
  credential_sha256: string | null;
}

async function activeRunner(db: Db, runnerId: string): Promise<(RunnerRow & { key: KeyObject }) | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runnerId)) return null;
  const [r] = await db.query<RunnerRow>('select public_key, credential_sha256 from sandbox_runners where id = $1 and revoked_at is null', [runnerId]);
  if (!r) return null;
  try {
    return { ...r, key: createPublicKey(r.public_key) };
  } catch {
    return null;
  }
}

const verifySig = (key: KeyObject, message: string, signature: string) => {
  try {
    return verify(null, Buffer.from(message), key, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
};

function credentialMatches(req: FastifyRequest, expectedSha: string | null): boolean {
  const header = req.headers.authorization ?? '';
  const prefix = `${RUNNER_AUTH_SCHEME} `;
  if (!expectedSha || !header.startsWith(prefix)) return false;
  const got = Buffer.from(sha256(header.slice(prefix.length)), 'hex');
  const want = Buffer.from(expectedSha, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Authenticates one signed scheduler request and consumes its timestamp (replay protection). */
export async function authenticateRunner(db: Db, req: FastifyRequest, purpose: RunnerRequestPurpose, fields: string[] = []): Promise<string> {
  const id = String(req.headers[RUNNER_ID_HEADER] ?? '');
  const ts = Number(req.headers[RUNNER_TS_HEADER]);
  const sig = String(req.headers[RUNNER_SIG_HEADER] ?? '');
  if (!Number.isSafeInteger(ts) || Math.abs(Date.now() - ts) > SCHEDULER_LIMITS.clockSkewMs) throw unauthorized(AUTH_FAILED);
  const runner = await activeRunner(db, id);
  if (!runner || !credentialMatches(req, runner.credential_sha256)) throw unauthorized(AUTH_FAILED);
  if (!verifySig(runner.key, canonicalRunnerRequest(purpose, id, ts, fields), sig)) throw unauthorized(AUTH_FAILED);
  const [fresh] = await db.query(
    'update sandbox_runners set last_request_ts = $2, last_seen_at = now() where id = $1 and revoked_at is null and last_request_ts < $2 returning id',
    [id, ts],
  );
  if (!fresh) throw unauthorized(AUTH_FAILED);
  return id;
}

/** Dead-letters jobs that can no longer run: too old in the queue, or out of attempts after a lost lease. */
async function sweep(db: Db) {
  await db.query(
    `update run_jobs set status = 'failed', finished_at = now(),
       failure_reason = case when status = 'queued' and attempts < max_attempts then 'queue_ttl' else 'max_attempts' end
     where (status = 'queued' and (attempts >= max_attempts or created_at < now() - make_interval(mins => $1)))
        or (status = 'leased' and lease_expires_at < now() and attempts >= max_attempts)`,
    [SCHEDULER_LIMITS.queuedTtlMinutes],
  );
}

type SubmissionCtx = { source: string; language_id: string; question_ref: { templateId?: string } | null };

export async function leaseJob(db: Db, runnerId: string): Promise<LeasedJob | null> {
  await sweep(db);
  return db.tx(async (sql) => {
    // Expired leases with attempts left are reclaimed. One executing run per user.
    const [job] = await sql.query<{ id: string; submission_id: string; suite: RunSuite }>(
      `select j.id, j.submission_id, j.suite from run_jobs j
       where (j.status = 'queued' or (j.status = 'leased' and j.lease_expires_at < now()))
         and j.attempts < j.max_attempts
         and not exists (select 1 from run_jobs a where a.user_id = j.user_id and a.id <> j.id and a.status = 'leased' and a.lease_expires_at >= now())
       order by j.created_at for update skip locked limit 1`,
    );
    if (!job) return null;
    const nonce = randomBytes(16).toString('hex');
    const [lease] = await sql.query<{ lease_id: string; lease_expires_at: Date }>(
      `update run_jobs set status = 'leased', lease_id = gen_random_uuid(), runner_id = $2, nonce = $3,
         leased_at = now(), heartbeat_at = null, lease_expires_at = now() + make_interval(secs => $4), attempts = attempts + 1
       where id = $1 returning lease_id, lease_expires_at`,
      [job.id, runnerId, nonce, SCHEDULER_LIMITS.leaseSeconds],
    );
    const [sub] = await sql.query<SubmissionCtx>(
      `select cs.source, cs.language_id, sr.question_ref from code_submissions cs join stage_runs sr on sr.id = cs.stage_run_id where cs.id = $1`,
      [job.submission_id],
    );
    const lang = (await getLanguage(sql, sub!.language_id))!;
    const body = sub!.question_ref?.templateId ? await questionBody(sql, sub!.question_ref.templateId) : null;
    const limits = ExecLimits.parse({ ...lang.limits, ...body?.limits?.[lang.slug] });
    // Only the tests of this one job, by opaque id. Names never leave the API (F4).
    const tests: RunnerTest[] = (body ? testsForSuite(body, job.suite) : []).map(({ id, hidden, t }) => ({
      id, input: t.input, expected: t.expected, weight: t.weight, hidden, timeLimitMs: t.timeLimitMs ?? null,
    }));
    return {
      jobId: job.id, leaseId: lease!.lease_id, nonce, leaseExpiresAt: iso(lease!.lease_expires_at), suite: job.suite,
      language: { slug: lang.slug, imageRef: lang.imageRef, compileCmd: lang.compileCmd, runCmd: lang.runCmd, limits },
      source: sub!.source, sourceSha256: sha256(sub!.source), tests,
    };
  });
}

export async function heartbeat(db: Db, runnerId: string, hb: HeartbeatRequest): Promise<HeartbeatResponse> {
  const [row] = await db.query<{ lease_expires_at: Date }>(
    `update run_jobs set heartbeat_at = now(),
       lease_expires_at = least(now() + make_interval(secs => $4), leased_at + make_interval(secs => $5))
     where id = $1 and lease_id = $2 and runner_id = $3 and status = 'leased' and lease_expires_at > now()
       and leased_at + make_interval(secs => $5) > now()
     returning lease_expires_at`,
    [hb.jobId, hb.leaseId, runnerId, SCHEDULER_LIMITS.leaseSeconds, SCHEDULER_LIMITS.maxLeaseSeconds],
  );
  return row ? { leaseExpiresAt: iso(row.lease_expires_at), cancel: false } : { leaseExpiresAt: null, cancel: true };
}

/** A signed result must also be internally consistent: the overall status agrees with the tests. */
function assertConsistent(r: RunnerResult) {
  const allPassed = r.perTest.every((t) => t.passed);
  const bad =
    (r.status === 'passed' && !allPassed) ||
    (r.status === 'failed' && allPassed && r.perTest.length > 0) ||
    r.perTest.some((t) => t.passed !== (t.status === 'passed')) ||
    new Set(r.perTest.map((t) => t.id)).size !== r.perTest.length;
  if (bad) throw new AppError(400, 'validation_failed', 'Validation failed', 'result is internally inconsistent');
}

export type AcceptOutcome = 'accepted' | 'requeued';

export async function acceptResult(db: Db, signed: SignedRunnerResult, authenticatedRunnerId: string): Promise<AcceptOutcome> {
  const r = signed.result;
  if (r.runnerId !== authenticatedRunnerId) throw unauthorized(AUTH_FAILED);
  const runner = await activeRunner(db, r.runnerId);
  if (!runner || !verifySig(runner.key, canonicalResult(r), signed.signature)) throw unauthorized('result signature invalid');
  assertConsistent(r);
  return db.tx(async (sql) => {
    const [job] = await sql.query<{
      id: string; user_id: string; submission_id: string; suite: RunSuite; status: string; lease_id: string | null;
      runner_id: string | null; nonce: string | null; live: boolean; attempts: number; max_attempts: number;
    }>(
      `select id, user_id, submission_id, suite, status, lease_id, runner_id, nonce, attempts, max_attempts,
         lease_expires_at > now() as live
       from run_jobs where id = $1 for update`,
      [r.jobId],
    );
    // Single acceptance: only the live lease of this runner with this nonce. A second submission
    // of the same result finds the job completed; a stale or foreign lease does not match.
    if (!job || job.status !== 'leased' || job.lease_id !== r.leaseId || job.runner_id !== r.runnerId || job.nonce !== r.nonce) {
      throw conflict('no live lease matches this result');
    }
    if (!job.live) throw conflict('lease expired');
    const [sub] = await sql.query<SubmissionCtx>(
      `select cs.source, cs.language_id, sr.question_ref from code_submissions cs join stage_runs sr on sr.id = cs.stage_run_id where cs.id = $1`,
      [job.submission_id],
    );
    if (sha256(sub!.source) !== r.sourceSha256) throw conflict('result is for different source');
    const body = sub!.question_ref?.templateId ? await questionBody(sql, sub!.question_ref.templateId) : null;
    const expected = body ? testsForSuite(body, job.suite) : [];
    const reported = new Map(r.perTest.map((t) => [t.id, t]));
    if (reported.size !== expected.length || expected.some((e) => !reported.has(e.id))) {
      throw new AppError(400, 'validation_failed', 'Validation failed', 'result does not cover the leased tests');
    }

    // Runner-side failure with attempts left: release the lease so another runner retries it.
    if (r.status === 'internal_error' && job.attempts < job.max_attempts) {
      await sql.query(
        `update run_jobs set status = 'queued', lease_id = null, runner_id = null, nonce = null, lease_expires_at = null where id = $1`,
        [job.id],
      );
      return 'requeued';
    }

    const perTest: StoredTest[] = expected.map((e) => {
      const t = reported.get(e.id)!;
      return { id: e.id, name: e.t.name, hidden: e.hidden, weight: e.t.weight, status: t.status, passed: t.passed, timeMs: t.timeMs, memKb: t.memKb };
    });
    const dead = r.status === 'internal_error';
    await sql.query(
      `update run_jobs set status = $2, finished_at = now(), failure_reason = $3 where id = $1`,
      [job.id, dead ? 'failed' : 'completed', dead ? 'runner_internal_error' : null],
    );
    await sql.query(
      `insert into run_results (job_id, user_id, runner_id, lease_id, status, per_test, stdout, stderr, signature)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [job.id, job.user_id, r.runnerId, r.leaseId, r.status, JSON.stringify(perTest), sanitizeOutput(r.stdout), sanitizeOutput(r.stderr), signed.signature],
    );
    return 'accepted';
  });
}

/**
 * Mounted on the internal listener, which binds to the runner network only. No candidate-reachable
 * route can lease jobs. Log lines carry ids, counts and statuses only (S22).
 */
export function registerSchedulerRoutes(app: FastifyInstance, db: Db) {
  app.post('/internal/scheduler/lease', async (req): Promise<LeaseResponse> => {
    const runnerId = await authenticateRunner(db, req, 'lease');
    const job = await leaseJob(db, runnerId);
    req.log.info({ runnerId, jobId: job?.jobId ?? null, language: job?.language.slug, testCount: job?.tests.length }, 'lease');
    return { job };
  });

  app.post('/internal/scheduler/heartbeat', async (req): Promise<HeartbeatResponse> => {
    const parsed = HeartbeatRequest.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error, 'body');
    const runnerId = await authenticateRunner(db, req, 'heartbeat', [parsed.data.jobId, parsed.data.leaseId]);
    return heartbeat(db, runnerId, parsed.data);
  });

  app.post('/internal/scheduler/results', async (req, reply) => {
    const parsed = SignedRunnerResult.safeParse(req.body);
    if (!parsed.success) throw validationError(parsed.error, 'body');
    const runner = await activeRunner(db, String(req.headers[RUNNER_ID_HEADER] ?? ''));
    if (!runner || !credentialMatches(req, runner.credential_sha256)) throw unauthorized(AUTH_FAILED);
    const r = parsed.data.result;
    const outcome = await acceptResult(db, parsed.data, String(req.headers[RUNNER_ID_HEADER]));
    req.log.info({ jobId: r.jobId, runnerId: r.runnerId, status: r.status, testCount: r.perTest.length, outcome }, 'run result');
    return reply.status(204).send();
  });
}
