import { IdParams, type MyAnalytics, type QuestionStatsList, type StageKind } from '@ai-interview/shared';
import type { Db, Sql } from '../../db/db';
import { isoOrNull } from '../../db/db';
import type { Route } from '../../http/route';

export type EventName =
  | 'resume_parsed'
  | 'session_started'
  | 'stage_completed'
  | 'session_completed'
  | 'session_abandoned'
  | 'submission_created'
  | 'run_requested'
  | 'evaluation_ready'
  | 'recommendations_ready';

/** Append-only. Props carry ids and numbers only, never free text. */
export async function track(sql: Sql, userId: string | null, name: EventName, props: Record<string, string | number | boolean | null>) {
  await sql.query('insert into events (user_id, name, props) values ($1, $2, $3)', [userId, name, JSON.stringify(props)]);
}

export function analyticsRoutes(route: Route, deps: { db: Db }) {
  const { db } = deps;

  route({ method: 'GET', url: '/v1/analytics/me' }, async ({ user }): Promise<MyAnalytics> =>
    db.asUser(user.id, async (sql) => {
      const counts = await sql.query<{ name: string; n: number; last: Date }>(
        'select name, count(*)::int as n, max(at) as last from events where user_id = $1 group by name',
        [user.id],
      );
      const [avg] = await sql.query<{ avg: number | null }>('select avg(overall) as avg from session_summaries where user_id = $1', [user.id]);
      const eventCounts = Object.fromEntries(counts.map((c) => [c.name, c.n]));
      const last = counts.reduce<Date | null>((m, c) => (!m || c.last > m ? c.last : m), null);
      return {
        sessionsStarted: eventCounts.session_started ?? 0,
        sessionsCompleted: eventCounts.session_completed ?? 0,
        averageOverall: avg?.avg ?? null,
        eventCounts,
        lastActiveAt: isoOrNull(last),
      };
    }),
  );

  // Per-question difficulty and discrimination across all candidates; aggregates only, no free text.
  route({ method: 'GET', url: '/v1/analytics/packs/:id/questions', params: IdParams, roles: ['admin'] }, async ({ params }): Promise<QuestionStatsList> => {
    const rows = await db.query<{ id: string; kind: StageKind; difficulty: number; asked: number; avg: number | null; disc: number | null }>(
      `select qt.id, qt.kind, qt.difficulty, count(sr.id)::int as asked, avg(se.score) as avg, corr(se.score, ss.overall) as disc
       from question_templates qt
       join pack_versions pv on pv.id = qt.pack_version_id
       left join stage_runs sr on sr.question_ref ->> 'templateId' = qt.id::text
       left join stage_evaluations se on se.stage_run_id = sr.id and se.status = 'scored'
       left join session_summaries ss on ss.session_id = sr.session_id
       where pv.pack_id = $1
       group by qt.id order by qt.kind, qt.difficulty`,
      [params.id],
    );
    return {
      items: rows.map((r) => ({
        questionTemplateId: r.id, kind: r.kind, difficulty: r.difficulty, timesAsked: r.asked,
        averageScore: r.avg ?? null, discrimination: r.disc === null || Number.isNaN(r.disc) ? null : r.disc,
      })),
    };
  });
}
