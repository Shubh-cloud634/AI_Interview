import { HistoryQuery, TrendsQuery, type HistoryList, type SessionSummary, type Trends } from '@ai-interview/shared';
import type { Db, Sql } from '../../db/db';
import { iso } from '../../db/db';
import type { Route } from '../../http/route';

/** Read model over finished sessions. Written once per session by evaluation finalize; listing never reads turns. */
export async function upsertSummary(
  sql: Sql,
  s: { sessionId: string; userId: string; domainId: string; modeSlug: string; overall: number | null; finishedAt: Date; topGaps: SessionSummary['topGaps'] },
) {
  await sql.query(
    `insert into session_summaries (session_id, user_id, domain_id, mode_slug, overall, finished_at, top_gaps) values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (session_id) do update set overall = $5, finished_at = $6, top_gaps = $7`,
    [s.sessionId, s.userId, s.domainId, s.modeSlug, s.overall, s.finishedAt, JSON.stringify(s.topGaps)],
  );
}

export async function priorInDomain(sql: Sql, userId: string, domainId: string, excludeSessionId: string) {
  const rows = await sql.query<{ session_id: string; overall: number; finished_at: Date }>(
    `select session_id, overall, finished_at from session_summaries
     where user_id = $1 and domain_id = $2 and session_id <> $3 and overall is not null order by finished_at desc limit 10`,
    [userId, domainId, excludeSessionId],
  );
  return rows.map((r) => ({ sessionId: r.session_id, overall: r.overall, finishedAt: iso(r.finished_at) })).reverse();
}

export function historyRoutes(route: Route, deps: { db: Db }) {
  const { db } = deps;

  route({ method: 'GET', url: '/v1/history', query: HistoryQuery }, async ({ user, query }): Promise<HistoryList> => {
    const rows = await db.asUser(user.id, (sql) =>
      sql.query<{ session_id: string; domain_id: string; mode_slug: string; overall: number | null; finished_at: Date; top_gaps: SessionSummary['topGaps'] }>(
        `select session_id, domain_id, mode_slug, overall, finished_at, top_gaps from session_summaries
         where user_id = $1 and ($2::uuid is null or domain_id = $2) and ($3::text is null or mode_slug = $3)
           and ($4::timestamptz is null or finished_at >= $4) and ($5::timestamptz is null or finished_at <= $5)
         order by finished_at desc limit $6`,
        [user.id, query.domain ?? null, query.mode ?? null, query.from ?? null, query.to ?? null, query.limit],
      ),
    );
    return {
      items: rows.map((r) => ({ sessionId: r.session_id, domainId: r.domain_id, modeSlug: r.mode_slug, overall: r.overall, finishedAt: iso(r.finished_at), topGaps: r.top_gaps })),
    };
  });

  route({ method: 'GET', url: '/v1/history/trends', query: TrendsQuery }, async ({ user, query }): Promise<Trends> => {
    const rows = await db.asUser(user.id, (sql) =>
      query.competency
        ? sql.query<{ session_id: string; score: number; finished_at: Date }>(
            `select ss.session_id, cs.score, ss.finished_at from competency_scores cs
             join evaluations e on e.id = cs.evaluation_id join session_summaries ss on ss.session_id = e.session_id
             where ss.user_id = $1 and cs.competency_id = $2 order by ss.finished_at`,
            [user.id, query.competency],
          )
        : sql.query<{ session_id: string; score: number; finished_at: Date }>(
            `select session_id, overall as score, finished_at from session_summaries where user_id = $1 and overall is not null order by finished_at`,
            [user.id],
          ),
    );
    return { competencyId: query.competency ?? null, points: rows.map((r) => ({ sessionId: r.session_id, score: r.score, finishedAt: iso(r.finished_at) })) };
  });
}
