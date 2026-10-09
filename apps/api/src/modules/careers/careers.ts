import { z } from 'zod';
import { IdParams, ModeSpec, type CompetencyGap, type LearningResource, type Recommendations, type RoleFit } from '@ai-interview/shared';
import { AiFailure, type TaskDef, type TaskRunner } from '../../ai/runner';
import type { Db, Sql } from '../../db/db';
import { isoOrNull } from '../../db/db';
import { notFound } from '../../http/errors';
import type { Route } from '../../http/route';
import { track } from '../analytics/analytics';

/**
 * CAREER RECOMMENDER role. Ranking, fit and gaps are arithmetic over readiness and role_requirements.
 * The model only phrases explanations and picks resources from the candidates the DB supplies.
 */

export interface Requirement {
  competencyId: string;
  name: string;
  minLevel: number;
  weight: number;
}

/** Pure. fit = weighted mean of min(1, current / required). */
export function roleFit(reqs: Requirement[], readiness: ReadonlyMap<string, number>): { fit: number; gaps: CompetencyGap[] } {
  const wsum = reqs.reduce((a, r) => a + r.weight, 0);
  if (wsum === 0) return { fit: 0, gaps: [] };
  const fit = reqs.reduce((a, r) => a + r.weight * Math.min(1, (readiness.get(r.competencyId) ?? 0) / r.minLevel), 0) / wsum;
  const gaps = reqs
    .map((r) => ({ competencyId: r.competencyId, name: r.name, required: r.minLevel, current: readiness.get(r.competencyId) ?? 0, weight: r.weight }))
    .filter((g) => g.current < g.required)
    .sort((a, b) => (b.required - b.current) * b.weight - (a.required - a.current) * a.weight);
  return { fit, gaps };
}

async function readinessMap(sql: Sql, userId: string) {
  const rows = await sql.query<{ competency_id: string; score: number }>('select competency_id, score from readiness where user_id = $1', [userId]);
  return new Map(rows.map((r) => [r.competency_id, r.score]));
}

async function requirementsByRole(sql: Sql, roleId?: string) {
  const rows = await sql.query<{ role_id: string; role_name: string; domain_id: string; competency_id: string; name: string; min_level: number; weight: number }>(
    `select r.id as role_id, r.name as role_name, r.domain_id, rr.competency_id, c.name, rr.min_level, rr.weight
     from roles r join role_requirements rr on rr.role_id = r.id join competencies c on c.id = rr.competency_id
     ${roleId ? 'where r.id = $1' : ''} order by r.name`,
    roleId ? [roleId] : [],
  );
  const roles = new Map<string, { name: string; domainId: string; reqs: Requirement[] }>();
  for (const r of rows) {
    const e = roles.get(r.role_id) ?? { name: r.role_name, domainId: r.domain_id, reqs: [] };
    e.reqs.push({ competencyId: r.competency_id, name: r.name, minLevel: r.min_level, weight: r.weight });
    roles.set(r.role_id, e);
  }
  return roles;
}

/** Domain detection: mean confidence-weighted readiness over each domain's published competencies. */
export async function detectDomains(sql: Sql, userId: string) {
  return sql.query<{ domainId: string; name: string; strength: number }>(
    `select d.id as "domainId", d.name, coalesce(avg(coalesce(r.score * r.confidence, 0)), 0) as strength
     from domains d join packs p on p.domain_id = d.id join pack_versions pv on pv.pack_id = p.id and pv.published_at is not null
     join competencies c on c.pack_version_id = pv.id
     left join readiness r on r.competency_id = c.id and r.user_id = $1
     where d.status = 'active' group by d.id, d.name order by strength desc, d.name`,
    [userId],
  );
}

/** Mode recommendation: the domain's published mode whose rubrics cover most of the weakest competencies. */
export async function nextMode(sql: Sql, domainId: string, weakCompetencyIds: string[]): Promise<{ modeId: string; name: string } | null> {
  const modes = await sql.query<{ id: string; name: string; spec: unknown; pack_version_id: string }>(
    `select distinct on (m.id) m.id, m.name, mv.spec, mv.pack_version_id
     from modes m join packs p on p.id = m.pack_id join mode_versions mv on mv.mode_id = m.id
     where p.domain_id = $1 and mv.published_at is not null order by m.id, mv.version desc`,
    [domainId],
  );
  const weak = new Set(weakCompetencyIds);
  let best: { modeId: string; name: string; overlap: number } | null = null;
  for (const m of modes) {
    const refs = ModeSpec.parse(m.spec).stages.map((s) => s.rubricRef);
    const comps = await sql.query<{ competency_id: string }>(
      `select distinct rc.competency_id from rubrics r join rubric_criteria rc on rc.rubric_id = r.id
       where r.pack_version_id = $1 and r.slug || '.v' || r.version = any($2::text[])`,
      [m.pack_version_id, refs],
    );
    const overlap = comps.filter((c) => weak.has(c.competency_id)).length;
    if (!best || overlap > best.overlap || (overlap === best.overlap && m.name < best.name)) best = { modeId: m.id, name: m.name, overlap };
  }
  return best && { modeId: best.modeId, name: best.name };
}

interface ExplainInput {
  roles: { id: string; name: string; fitPercent: number; gaps: string[] }[];
  resources: { id: string; title: string; skill: string }[];
}

function explainSchema(i: ExplainInput) {
  const roleIds = i.roles.map((r) => r.id) as [string, ...string[]];
  const resourceIds = (i.resources.length ? i.resources.map((r) => r.id) : ['none']) as [string, ...string[]];
  return z.object({
    roles: z.array(z.object({ roleId: z.enum(roleIds), explanation: z.string().min(1).max(600) })).max(roleIds.length),
    resources: z.array(z.object({ resourceId: z.enum(resourceIds), reason: z.string().min(1).max(300) })).max(5),
  });
}

const matchRolesTask: TaskDef<ExplainInput, z.infer<ReturnType<typeof explainSchema>>> = {
  role: 'career',
  task: 'matchRoles',
  promptRef: () => 'career/match-roles.v1',
  tier: 'primary',
  effort: 'low',
  maxTokens: 3000,
  vars: (i) => ({
    roles: i.roles.map((r) => `- id: ${r.id}\n  name: ${r.name}\n  fit: ${r.fitPercent}%\n  gaps: ${r.gaps.join(', ') || 'none'}`).join('\n'),
    resources: i.resources.map((r) => `- id: ${r.id}\n  title: ${r.title}\n  skill: ${r.skill}`).join('\n') || '- none',
  }),
  data: () => ({}),
  maxDataChars: 1,
  output: explainSchema,
  check: (o) => (new Set(o.resources.map((r) => r.resourceId)).size !== o.resources.length ? 'duplicate resource' : null),
};

const TOP_ROLES = 5;

export function createRecommender(deps: { db: Db; run: TaskRunner }) {
  const { db, run } = deps;

  return async function recommend({ userId, evaluationId }: { userId: string; evaluationId: string | null }) {
    const plan = await db.tx(async (sql) => {
      const ready = await readinessMap(sql, userId);
      const fits = [...(await requirementsByRole(sql))]
        .map(([roleId, r]) => ({ roleId, name: r.name, domainId: r.domainId, ...roleFit(r.reqs, ready) }))
        .sort((a, b) => b.fit - a.fit || a.name.localeCompare(b.name))
        .slice(0, TOP_ROLES);
      const domains = await detectDomains(sql, userId);
      const gaps = fits[0]?.gaps ?? [];
      const resources = gaps.length
        ? await sql.query<{ id: string; title: string; url: string; skill: string; level: number }>(
            `select res.id, res.title, res.url, s.name as skill, res.level, max(sc.weight) as w
             from resources res join skills s on s.id = res.skill_id join skill_competencies sc on sc.skill_id = s.id
             where sc.competency_id = any($1::uuid[]) group by res.id, s.name order by w desc, res.level, res.title limit 10`,
            [gaps.map((g) => g.competencyId)],
          )
        : [];
      const domainId = fits[0]?.domainId ?? domains[0]?.domainId;
      const mode = domainId ? await nextMode(sql, domainId, gaps.map((g) => g.competencyId)) : null;
      return { fits, domains, gaps, resources, mode };
    });

    let explained: z.infer<ReturnType<typeof explainSchema>> | null = null;
    if (plan.fits.length) {
      try {
        explained = (
          await run(
            matchRolesTask,
            {
              roles: plan.fits.map((f) => ({ id: f.roleId, name: f.name, fitPercent: Math.round(f.fit * 100), gaps: f.gaps.map((g) => g.name) })),
              resources: plan.resources.map((r) => ({ id: r.id, title: r.title, skill: r.skill })),
            },
            { userId },
          )
        ).output;
      } catch (err) {
        if (!(err instanceof AiFailure)) throw err;
      }
    }
    const explanation = new Map(explained?.roles.map((r) => [r.roleId, r.explanation]));
    const reasons = new Map(explained?.resources.map((r) => [r.resourceId, r.reason]));
    // The model may reorder its picks; without picks, fall back to the DB ranking.
    const picked = explained?.resources.length ? plan.resources.filter((r) => reasons.has(r.id)) : plan.resources.slice(0, 5);

    await db.tx(async (sql) => {
      await sql.query('delete from recommendations where user_id = $1', [userId]);
      const add = (type: string, payload: unknown) =>
        sql.query('insert into recommendations (user_id, evaluation_id, type, payload) values ($1, $2, $3, $4)', [userId, evaluationId, type, JSON.stringify(payload)]);
      await add('domain', plan.domains);
      for (const f of plan.fits) await add('role_match', { ...f, explanation: explanation.get(f.roleId) ?? null } satisfies RoleFit);
      await add('gap', plan.gaps);
      await add('learning_path', picked.map((r) => ({ id: r.id, title: r.title, url: r.url, skillName: r.skill, level: r.level, reason: reasons.get(r.id) ?? null }) satisfies LearningResource));
      await add('next_mode', plan.mode);
      await track(sql, userId, 'recommendations_ready', { roles: plan.fits.length });
    });
  };
}

export function careerRoutes(route: Route, deps: { db: Db }) {
  const { db } = deps;

  route({ method: 'GET', url: '/v1/recommendations' }, async ({ user }): Promise<Recommendations> =>
    db.asUser(user.id, async (sql) => {
      const rows = await sql.query<{ type: string; payload: unknown; created_at: Date }>(
        'select type, payload, created_at from recommendations where user_id = $1 order by created_at, id',
        [user.id],
      );
      const of = <T>(type: string) => rows.filter((r) => r.type === type).map((r) => r.payload as T);
      return {
        generatedAt: isoOrNull(rows[0]?.created_at ?? null),
        domains: of<Recommendations['domains']>('domain')[0] ?? [],
        roles: of<RoleFit>('role_match'),
        gaps: of<CompetencyGap[]>('gap')[0] ?? [],
        learningPath: of<LearningResource[]>('learning_path')[0] ?? [],
        nextMode: of<Recommendations['nextMode']>('next_mode')[0] ?? null,
      };
    }),
  );

  route({ method: 'GET', url: '/v1/roles/:id/fit', params: IdParams }, async ({ user, params }): Promise<RoleFit> =>
    db.asUser(user.id, async (sql) => {
      const roles = await requirementsByRole(sql, params.id);
      const role = roles.get(params.id);
      if (!role) {
        const [exists] = await sql.query<{ name: string; domain_id: string }>('select name, domain_id from roles where id = $1', [params.id]);
        if (!exists) throw notFound('role');
        return { roleId: params.id, name: exists.name, domainId: exists.domain_id, fit: 0, gaps: [], explanation: null };
      }
      return { roleId: params.id, name: role.name, domainId: role.domainId, ...roleFit(role.reqs, await readinessMap(sql, user.id)), explanation: null };
    }),
  );
}
