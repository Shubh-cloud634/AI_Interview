import type { FastifyBaseLogger } from 'fastify';
import type { Db, Sql } from '../db/db';

export interface JobPayloads {
  parse_resume: { resumeId: string };
  evaluate_stage: { stageRunId: string };
  finalize_evaluation: { sessionId: string };
  recommend: { userId: string; evaluationId: string | null };
}
export type JobName = keyof JobPayloads;
export type JobHandlers = { [K in JobName]: (payload: JobPayloads[K]) => Promise<void> };

/** Throw from a handler to reschedule without consuming an attempt (e.g. waiting on other jobs). */
export class RetryLater extends Error {
  constructor(readonly delayMs: number, reason: string) {
    super(reason);
  }
}

/**
 * Enqueue inside the caller's transaction, so the job exists iff the state change committed.
 * A singleton key makes the enqueue idempotent: the second enqueue with the same key is a no-op.
 */
export async function enqueue<K extends JobName>(
  sql: Sql,
  name: K,
  payload: JobPayloads[K],
  opts: { key?: string; runAfter?: Date } = {},
): Promise<void> {
  await sql.query('select enqueue_job($1, $2, $3, $4)', [name, JSON.stringify(payload), opts.key ?? null, opts.runAfter ?? null]);
}

interface JobRow {
  id: string;
  name: JobName;
  payload: never;
  attempts: number;
  max_attempts: number;
}

const LEASE_SECONDS = 300;

async function claim(db: Db, limit: number, ignoreSchedule: boolean): Promise<JobRow[]> {
  return db.query<JobRow>(
    `update jobs set status = 'active', attempts = attempts + 1, locked_until = now() + make_interval(secs => $2)
     where id in (
       select id from jobs
       where (status = 'queued' and ($3 or run_after <= now())) or (status = 'active' and locked_until < now())
       order by run_after
       for update skip locked
       limit $1)
     returning id, name, payload, attempts, max_attempts`,
    [limit, LEASE_SECONDS, ignoreSchedule],
  );
}

async function settle(db: Db, job: JobRow, err: unknown) {
  if (!err) {
    await db.query(`update jobs set status = 'done', locked_until = null where id = $1`, [job.id]);
    return;
  }
  if (err instanceof RetryLater) {
    await db.query(
      `update jobs set status = 'queued', attempts = attempts - 1, run_after = now() + make_interval(secs => $2), last_error = $3 where id = $1`,
      [job.id, err.delayMs / 1000, err.message.slice(0, 500)],
    );
    return;
  }
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
  const failed = job.attempts >= job.max_attempts;
  await db.query(
    `update jobs set status = $2, run_after = now() + make_interval(secs => $3), last_error = $4, locked_until = null where id = $1`,
    [job.id, failed ? 'failed' : 'queued', 2 ** job.attempts * 5, message],
  );
}

export async function runJob(db: Db, handlers: JobHandlers, job: JobRow, log: FastifyBaseLogger) {
  let error: unknown = null;
  try {
    await handlers[job.name](job.payload);
  } catch (err) {
    error = err;
    if (!(err instanceof RetryLater)) log.warn({ jobId: job.id, job: job.name, attempt: job.attempts, err }, 'job failed');
  }
  await settle(db, job, error);
}

/** Processes due jobs until none are left. ignoreSchedule runs retries immediately (tests). */
export async function drain(db: Db, handlers: JobHandlers, log: FastifyBaseLogger, opts: { ignoreSchedule?: boolean; maxRounds?: number } = {}) {
  for (let round = 0; round < (opts.maxRounds ?? 50); round++) {
    const jobs = await claim(db, 10, opts.ignoreSchedule ?? false);
    if (jobs.length === 0) return;
    for (const job of jobs) await runJob(db, handlers, job, log);
  }
}

export function startWorkers(db: Db, handlers: JobHandlers, log: FastifyBaseLogger, pollMs = 1000): () => Promise<void> {
  let stopped = false;
  let current: Promise<void> = Promise.resolve();
  const tick = async () => {
    while (!stopped) {
      const jobs = await claim(db, 5, false).catch((err) => {
        log.error({ err }, 'job claim failed');
        return [];
      });
      if (jobs.length === 0) break;
      await Promise.all(jobs.map((j) => runJob(db, handlers, j, log)));
    }
  };
  const timer = setInterval(() => {
    current = current.then(tick);
  }, pollMs);
  return async () => {
    stopped = true;
    clearInterval(timer);
    await current;
  };
}
