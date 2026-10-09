import {
  CreateSubmissionRequest,
  IdParams,
  KIND_CONTENT,
  type QuestionBody,
  type RunJob,
  type RunJobStatus,
  type RunStatus,
  type RunSuite,
  type Submission,
  type SubmissionList,
  type SubmissionResult,
} from '@ai-interview/shared';
import type { Db, Sql } from '../../db/db';
import { iso } from '../../db/db';
import { AppError, invalidState, notFound } from '../../http/errors';
import { idempotent } from '../../http/idempotency';
import type { Route } from '../../http/route';
import { track } from '../analytics/analytics';
import { questionBody } from '../catalog/catalog';
import { stageRunContext } from '../interview/engine';
import { candidateView, languageAllowed, type StoredTest } from './problem';

/**
 * Candidate-facing coding endpoints. Nothing here executes code: a run is a run_jobs row that a
 * separate runner leases through the scheduler contract (modules/sandbox/scheduler.ts).
 */

export const CODING_LIMITS = {
  /** Global cap on queued jobs before new practice runs are refused (F8). */
  maxQueueDepth: 500,
  /** Practice runs a user may start per rolling minute, counted in the database so it holds across API instances. */
  runsPerUserPerMinute: 10,
  /** Practice runs per client IP per minute, per API instance (S18). */
  runsPerIpPerMinute: 30,
  /** Submissions kept per stage run; bounds storage per attempt. */
  maxSubmissionsPerStage: 200,
} as const;

export const tooMany = (detail: string, retryAfterSec: number) =>
  Object.assign(new AppError(429, 'rate_limited', 'Too many requests', detail), { headers: { 'retry-after': String(retryAfterSec) } });

const badLanguage = (message: string) =>
  new AppError(400, 'validation_failed', 'Validation failed', message, { errors: [{ path: 'body.languageId', message }] });

/** Fixed-window counter keyed by IP. Per instance; the DB-backed per-user limit is the durable one. */
export function ipWindowLimiter(max: number, windowMs = 60_000, now = () => Date.now()) {
  const hits = new Map<string, { start: number; n: number }>();
  return (key: string): number | null => {
    const t = now();
    if (hits.size > 10_000) for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k);
    const w = hits.get(key);
    if (!w || t - w.start >= windowMs) {
      hits.set(key, { start: t, n: 1 });
      return null;
    }
    w.n += 1;
    return w.n > max ? Math.ceil((w.start + windowMs - t) / 1000) : null;
  };
}

type Ctx = NonNullable<Awaited<ReturnType<typeof stageRunContext>>>;

/** S19: server-authoritative deadline. The stage must be the live one and inside timeLimitSec plus grace. */
export async function assertOpenForCode(sql: Sql, stageRunId: string, graceSec: number, now = Date.now()): Promise<Ctx> {
  const ctx = await stageRunContext(sql, stageRunId);
  if (!ctx) throw notFound('stage run');
  if (!KIND_CONTENT[ctx.kind].includes('code')) throw invalidState(`a ${ctx.kind} stage does not take code submissions`);
  if (ctx.status !== 'active' || ctx.sessionStatus !== 'awaiting_answer') throw invalidState('stage is not accepting submissions');
  if (ctx.deadline && now > ctx.deadline.getTime() + graceSec * 1000) throw invalidState('stage time limit has passed');
  return ctx;
}

async function problemOf(sql: Sql, ctx: Ctx): Promise<QuestionBody | null> {
  const ref = ctx.questionRef as { templateId?: string } | null;
  return ref?.templateId ? questionBody(sql, ref.templateId) : null;
}

async function enabledLanguage(sql: Sql, id: string) {
  const [l] = await sql.query<{ slug: string; enabled: boolean }>('select slug, enabled from languages where id = $1', [id]);
  return l?.enabled ? l : null;
}

type SubmissionRow = { id: string; stage_run_id: string; language_id: string; source: string; explanation: string | null; created_at: Date };
const SUBMISSION_COLS = 'id, stage_run_id, language_id, source, explanation, created_at';
const toSubmission = (r: SubmissionRow): Submission => ({
  id: r.id, stageRunId: r.stage_run_id, languageId: r.language_id, source: r.source, explanation: r.explanation, createdAt: iso(r.created_at),
});

const isUniqueViolation = (err: unknown) => (err as { code?: string })?.code === '23505';

export function codingRoutes(route: Route, deps: { db: Db; graceSec: number; now?: () => number }) {
  const { db, graceSec } = deps;
  const now = deps.now ?? Date.now;
  const ipLimit = ipWindowLimiter(CODING_LIMITS.runsPerIpPerMinute, 60_000, now);

  // Idempotent on Idempotency-Key. Source size (64 KB) and explanation length are checked by the
  // shared schema at the boundary and again by table constraints.
  route(
    { method: 'POST', url: '/v1/stage-runs/:id/submissions', params: IdParams, body: CreateSubmissionRequest, limit: 'run' },
    async ({ user, params, body, req, reply }): Promise<Submission> =>
      idempotent(db, user.id, req, reply, 201, () =>
        db.asUser(user.id, async (sql) => {
          const ctx = await assertOpenForCode(sql, params.id, graceSec, now());
          const lang = await enabledLanguage(sql, body.languageId);
          if (!lang) throw badLanguage('unknown language');
          if (!languageAllowed(await problemOf(sql, ctx), lang.slug)) throw badLanguage('language not allowed for this problem');
          const [{ n }] = (await sql.query<{ n: number }>(
            'select count(*)::int as n from code_submissions where stage_run_id = $1',
            [params.id],
          )) as [{ n: number }];
          if (n >= CODING_LIMITS.maxSubmissionsPerStage) throw tooMany('submission limit for this stage reached', 60);
          const [row] = await sql.query<SubmissionRow>(
            `insert into code_submissions (stage_run_id, user_id, language_id, source, explanation) values ($1, $2, $3, $4, $5)
             returning ${SUBMISSION_COLS}`,
            [params.id, user.id, body.languageId, body.source, body.explanation ?? null],
          );
          await track(sql, user.id, 'submission_created', { submissionId: row!.id, stageRunId: params.id });
          return toSubmission(row!);
        }),
      ),
  );

  // History of the caller's submissions for one stage run. RLS scopes every row to the caller, so
  // another user's stage run is a 404, not a 403.
  route({ method: 'GET', url: '/v1/stage-runs/:id/submissions', params: IdParams }, async ({ user, params }): Promise<SubmissionList> =>
    db.asUser(user.id, async (sql) => {
      const [sr] = await sql.query('select 1 from stage_runs where id = $1 and user_id = $2', [params.id, user.id]);
      if (!sr) throw notFound('stage run');
      const rows = await sql.query<SubmissionRow>(
        `select ${SUBMISSION_COLS} from code_submissions where stage_run_id = $1 and user_id = $2 order by created_at, id limit $3`,
        [params.id, user.id, CODING_LIMITS.maxSubmissionsPerStage],
      );
      return { items: rows.map(toSubmission) };
    }),
  );

  // Practice run against the sample tests. One active practice run per user (a partial unique index
  // makes this race-free), per-user and per-IP rate limits, and a global queue depth cap.
  route({ method: 'POST', url: '/v1/submissions/:id/run', params: IdParams, limit: 'run' }, async ({ user, params, req, reply }): Promise<RunJob> => {
    const ipRetry = ipLimit(req.ip);
    if (ipRetry !== null) throw tooMany('too many runs from this address', ipRetry);
    const [{ depth }] = (await db.query<{ depth: number }>(`select count(*)::int as depth from run_jobs where status = 'queued'`)) as [{ depth: number }];
    if (depth >= CODING_LIMITS.maxQueueDepth) throw tooMany('run queue is full', 10);

    const job = await db.asUser(user.id, async (sql) => {
      const [sub] = await sql.query<{ stage_run_id: string; language_id: string }>(
        'select stage_run_id, language_id from code_submissions where id = $1 and user_id = $2',
        [params.id, user.id],
      );
      if (!sub) throw notFound('submission');
      await assertOpenForCode(sql, sub.stage_run_id, graceSec, now());
      if (!(await enabledLanguage(sql, sub.language_id))) throw invalidState('this language is currently disabled');

      const active = await sql.query<{ id: string; submission_id: string; status: RunJobStatus }>(
        `select id, submission_id, status from run_jobs where user_id = $1 and suite = 'visible' and status in ('queued', 'leased')`,
        [user.id],
      );
      // A retry of the same request returns the run already in flight instead of failing.
      const same = active.find((a) => a.submission_id === params.id);
      if (same) return { ...same, created: false };
      if (active.length) throw tooMany('a run is already in progress', 5);

      const [{ recent }] = (await sql.query<{ recent: number }>(
        `select count(*)::int as recent from run_jobs where user_id = $1 and suite = 'visible' and created_at > now() - interval '60 seconds'`,
        [user.id],
      )) as [{ recent: number }];
      if (recent >= CODING_LIMITS.runsPerUserPerMinute) throw tooMany('run rate limit reached', 60);

      try {
        const [row] = await sql.query<{ id: string; status: RunJobStatus }>(
          `insert into run_jobs (submission_id, user_id, suite) values ($1, $2, 'visible') returning id, status`,
          [params.id, user.id],
        );
        await track(sql, user.id, 'run_requested', { submissionId: params.id });
        return { ...row!, created: true };
      } catch (err) {
        if (isUniqueViolation(err)) throw tooMany('a run is already in progress', 5);
        throw err;
      }
    });
    reply.status(202);
    return { jobId: job.id, submissionId: params.id, suite: 'visible', status: job.status };
  });

  route({ method: 'GET', url: '/v1/submissions/:id/result', params: IdParams }, async ({ user, params }): Promise<SubmissionResult> =>
    db.asUser(user.id, async (sql) => {
      const [sub] = await sql.query('select 1 from code_submissions where id = $1 and user_id = $2', [params.id, user.id]);
      if (!sub) throw notFound('submission');
      const [job] = await sql.query<{ id: string; suite: RunSuite; status: RunJobStatus }>(
        'select id, suite, status from run_jobs where submission_id = $1 order by created_at desc, id limit 1',
        [params.id],
      );
      if (!job) return { submissionId: params.id, suite: null, jobStatus: null, result: null };
      const [res] = await sql.query<{ status: RunStatus; per_test: StoredTest[]; stdout: string; stderr: string }>(
        'select status, per_test, stdout, stderr from run_results where job_id = $1',
        [job.id],
      );
      return { submissionId: params.id, suite: job.suite, jobStatus: job.status, result: res ? candidateView(res) : null };
    }),
  );
}
