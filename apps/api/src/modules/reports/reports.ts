import { IdParams, type Pending, type Report, type ReportBody } from '@ai-interview/shared';
import type { Db, Sql } from '../../db/db';
import { iso } from '../../db/db';
import { notFound } from '../../http/errors';
import type { Route } from '../../http/route';

/** Reports are materialized once from a finished evaluation; they never recompute scores. */
export async function saveReport(sql: Sql, evaluationId: string, userId: string, body: ReportBody) {
  await sql.query('insert into reports (evaluation_id, user_id, body) values ($1, $2, $3) on conflict (evaluation_id) do nothing', [
    evaluationId, userId, JSON.stringify(body),
  ]);
}

export async function reportForSession(sql: Sql, sessionId: string) {
  const [r] = await sql.query<{ id: string; evaluation_id: string; body: ReportBody; rendered_at: Date }>(
    'select r.id, r.evaluation_id, r.body, r.rendered_at from reports r join evaluations e on e.id = r.evaluation_id where e.session_id = $1',
    [sessionId],
  );
  return r ? { id: r.id, evaluationId: r.evaluation_id, sessionId, body: r.body, renderedAt: iso(r.rendered_at) } satisfies Report : null;
}

export function reportRoutes(route: Route, deps: { db: Db }) {
  const { db } = deps;
  route({ method: 'GET', url: '/v1/sessions/:id/report', params: IdParams }, async ({ user, params, reply }): Promise<Report | Pending> =>
    db.asUser(user.id, async (sql) => {
      const [s] = await sql.query('select 1 from sessions where id = $1', [params.id]);
      if (!s) throw notFound('session');
      const report = await reportForSession(sql, params.id);
      if (report) return report;
      reply.status(202);
      return { status: 'pending' } as const;
    }),
  );
}
