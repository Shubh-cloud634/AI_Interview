import {
  CreatePackRequest,
  CreatePackVersionRequest,
  IdParams,
  ModeSpec,
  QuestionBody,
  type CareerRoleList,
  type DomainList,
  type ExecLimits,
  type LanguageList,
  type ModeDetail,
  type ModeList,
  type Pack,
  type PackContent,
  type PackVersion,
  type RubricLevel,
  type StageKind,
} from '@ai-interview/shared';
import type { Db, Sql } from '../../db/db';
import { iso, isoOrNull } from '../../db/db';
import { AppError, notFound } from '../../http/errors';
import { idempotent } from '../../http/idempotency';
import type { Route } from '../../http/route';

// ---------- interface used by other modules ----------

export interface ModeVersion {
  modeVersionId: string;
  modeId: string;
  modeSlug: string;
  modeName: string;
  packVersionId: string;
  domainId: string;
  spec: ModeSpec;
}

const MODE_VERSION_SELECT = `
  select mv.id as mode_version_id, m.id as mode_id, m.slug as mode_slug, m.name as mode_name,
         mv.pack_version_id, p.domain_id, mv.spec, mv.version, mv.published_at
  from mode_versions mv join modes m on m.id = mv.mode_id join packs p on p.id = m.pack_id`;

type ModeRow = {
  mode_version_id: string; mode_id: string; mode_slug: string; mode_name: string;
  pack_version_id: string; domain_id: string; spec: unknown; version: number; published_at: Date;
};

const toModeVersion = (r: ModeRow): ModeVersion => ({
  modeVersionId: r.mode_version_id,
  modeId: r.mode_id,
  modeSlug: r.mode_slug,
  modeName: r.mode_name,
  packVersionId: r.pack_version_id,
  domainId: r.domain_id,
  spec: ModeSpec.parse(r.spec),
});

async function latestModeRow(sql: Sql, modeId: string): Promise<ModeRow | undefined> {
  const [row] = await sql.query<ModeRow>(
    `${MODE_VERSION_SELECT} where m.id = $1 and mv.published_at is not null order by mv.version desc limit 1`,
    [modeId],
  );
  return row;
}

export async function latestModeVersion(sql: Sql, modeId: string): Promise<ModeVersion | undefined> {
  const row = await latestModeRow(sql, modeId);
  return row && toModeVersion(row);
}

export async function getModeVersion(sql: Sql, modeVersionId: string): Promise<ModeVersion> {
  const [row] = await sql.query<ModeRow>(`${MODE_VERSION_SELECT} where mv.id = $1`, [modeVersionId]);
  if (!row) throw notFound('mode version');
  return toModeVersion(row);
}

export interface RubricCriterion {
  id: string;
  competencyId: string;
  competencySlug: string;
  competencyName: string;
  name: string;
  weight: number;
  levels: RubricLevel[];
}

export interface Rubric {
  id: string;
  ref: string;
  criteria: RubricCriterion[];
}

export async function resolveRubric(sql: Sql, packVersionId: string, ref: string): Promise<Rubric> {
  const rows = await sql.query<{
    rubric_id: string; id: string; competency_id: string; competency_slug: string; competency_name: string;
    name: string; weight: number; levels: RubricLevel[];
  }>(
    `select r.id as rubric_id, rc.id, rc.competency_id, c.slug as competency_slug, c.name as competency_name,
            rc.name, rc.weight, rc.levels
     from rubrics r join rubric_criteria rc on rc.rubric_id = r.id join competencies c on c.id = rc.competency_id
     where r.pack_version_id = $1 and r.slug || '.v' || r.version = $2
     order by rc.name`,
    [packVersionId, ref],
  );
  if (rows.length === 0) throw new Error(`rubric ${ref} not found in pack version ${packVersionId}`);
  return {
    id: rows[0]!.rubric_id,
    ref,
    criteria: rows.map((r) => ({
      id: r.id, competencyId: r.competency_id, competencySlug: r.competency_slug, competencyName: r.competency_name,
      name: r.name, weight: r.weight, levels: r.levels,
    })),
  };
}

export interface BankQuestion {
  id: string;
  difficulty: number;
}

export async function bankQuestions(sql: Sql, packVersionId: string, kind: StageKind, tags: string[]): Promise<BankQuestion[]> {
  return sql.query<BankQuestion>(
    `select id, difficulty from question_templates
     where pack_version_id = $1 and kind = $2 and tags @> $3::text[] order by id`,
    [packVersionId, kind, tags],
  );
}

export async function questionBody(sql: Sql, templateId: string): Promise<QuestionBody> {
  const [row] = await sql.query<{ body: unknown }>('select body from question_templates where id = $1', [templateId]);
  if (!row) throw notFound('question template');
  return QuestionBody.parse(row.body);
}

export interface Language {
  id: string;
  slug: string;
  imageRef: string;
  compileCmd: string | null;
  runCmd: string;
  limits: ExecLimits;
}

export async function getLanguage(sql: Sql, id: string): Promise<Language | undefined> {
  const [row] = await sql.query<{ id: string; slug: string; image_ref: string; compile_cmd: string | null; run_cmd: string; limits: ExecLimits }>(
    'select id, slug, image_ref, compile_cmd, run_cmd, limits from languages where id = $1',
    [id],
  );
  return row && { id: row.id, slug: row.slug, imageRef: row.image_ref, compileCmd: row.compile_cmd, runCmd: row.run_cmd, limits: row.limits };
}

// ---------- authoring ----------

/** Rejects content whose references would fail at interview time. */
function checkPackContent(content: PackContent, promptExists: (ref: string) => boolean) {
  const problems: { path: string; message: string }[] = [];
  const competencies = new Set(content.competencies.map((c) => c.slug));
  const rubrics = new Set(content.rubrics.map((r) => `${r.slug}.v${r.version}`));
  content.competencies.forEach((c, i) => {
    if (c.parentSlug && !competencies.has(c.parentSlug)) problems.push({ path: `content.competencies.${i}.parentSlug`, message: 'unknown competency' });
  });
  content.rubrics.forEach((r, i) =>
    r.criteria.forEach((c, j) => {
      if (!competencies.has(c.competencySlug)) problems.push({ path: `content.rubrics.${i}.criteria.${j}.competencySlug`, message: 'unknown competency' });
    }),
  );
  content.questionTemplates.forEach((q, i) => {
    if (q.rubricRef && !rubrics.has(q.rubricRef)) problems.push({ path: `content.questionTemplates.${i}.rubricRef`, message: 'unknown rubric' });
  });
  content.modes.forEach((m, i) =>
    m.spec.stages.forEach((s, j) => {
      const at = `content.modes.${i}.spec.stages.${j}`;
      if (!rubrics.has(s.rubricRef)) problems.push({ path: `${at}.rubricRef`, message: 'unknown rubric' });
      if (s.questionSource.type === 'generated' && !promptExists(s.questionSource.promptRef)) {
        problems.push({ path: `${at}.questionSource.promptRef`, message: 'unknown prompt' });
      }
      if (s.questionSource.type === 'bank') {
        const tags = s.questionSource.tags;
        if (!content.questionTemplates.some((q) => q.kind === s.kind && tags.every((t) => q.tags.includes(t)))) {
          problems.push({ path: `${at}.questionSource`, message: 'no question template matches kind and tags' });
        }
      }
    }),
  );
  if (problems.length) throw new AppError(400, 'validation_failed', 'Validation failed', 'pack content has broken references', { errors: problems });
}

async function insertPackContent(sql: Sql, packId: string, packVersionId: string, content: PackContent) {
  const compIds = new Map<string, string>();
  for (const c of content.competencies) {
    const [row] = await sql.query<{ id: string }>(
      'insert into competencies (pack_version_id, slug, name, description) values ($1, $2, $3, $4) returning id',
      [packVersionId, c.slug, c.name, c.description],
    );
    compIds.set(c.slug, row!.id);
  }
  for (const c of content.competencies) {
    if (c.parentSlug) await sql.query('update competencies set parent_id = $1 where id = $2', [compIds.get(c.parentSlug), compIds.get(c.slug)]);
  }
  const rubricIds = new Map<string, string>();
  for (const r of content.rubrics) {
    const [row] = await sql.query<{ id: string }>(
      'insert into rubrics (pack_version_id, slug, version) values ($1, $2, $3) returning id',
      [packVersionId, r.slug, r.version],
    );
    rubricIds.set(`${r.slug}.v${r.version}`, row!.id);
    for (const c of r.criteria) {
      await sql.query('insert into rubric_criteria (rubric_id, competency_id, name, weight, levels) values ($1, $2, $3, $4, $5)', [
        row!.id, compIds.get(c.competencySlug), c.name, c.weight, JSON.stringify(c.levels),
      ]);
    }
  }
  for (const q of content.questionTemplates) {
    await sql.query(
      'insert into question_templates (pack_version_id, kind, tags, difficulty, body, rubric_id) values ($1, $2, $3, $4, $5, $6)',
      [packVersionId, q.kind, q.tags, q.difficulty, JSON.stringify(q.body), q.rubricRef ? rubricIds.get(q.rubricRef) : null],
    );
  }
  for (const m of content.modes) {
    const [mode] = await sql.query<{ id: string }>(
      `insert into modes (pack_id, slug, name) values ($1, $2, $3)
       on conflict (pack_id, slug) do update set name = excluded.name returning id`,
      [packId, m.slug, m.name],
    );
    await sql.query(
      `insert into mode_versions (mode_id, pack_version_id, version, spec)
       values ($1, $2, coalesce((select max(version) from mode_versions where mode_id = $1), 0) + 1, $3)`,
      [mode!.id, packVersionId, JSON.stringify(m.spec)],
    );
  }
}

const toPackVersion = (r: { id: string; pack_id: string; version: number; published_at: Date | null; content_hash: string | null }): PackVersion => ({
  id: r.id, packId: r.pack_id, version: r.version, publishedAt: isoOrNull(r.published_at), contentHash: r.content_hash,
});

// ---------- routes ----------

export function catalogRoutes(route: Route, deps: { db: Db; promptExists: (ref: string) => boolean }) {
  const { db, promptExists } = deps;
  const read = <T>(userId: string, fn: (sql: Sql) => Promise<T>) => db.asUser(userId, fn);

  route({ method: 'GET', url: '/v1/domains' }, async ({ user }): Promise<DomainList> => ({
    items: await read(user.id, (sql) => sql.query(`select id, slug, name from domains where status = 'active' order by name`)),
  }));

  route({ method: 'GET', url: '/v1/domains/:id/roles', params: IdParams }, async ({ user, params }): Promise<CareerRoleList> => {
    const rows = await read(user.id, (sql) =>
      sql.query<{ id: string; domain_id: string; slug: string; name: string }>('select id, domain_id, slug, name from roles where domain_id = $1 order by name', [params.id]),
    );
    return { items: rows.map((r) => ({ id: r.id, domainId: r.domain_id, slug: r.slug, name: r.name })) };
  });

  route({ method: 'GET', url: '/v1/domains/:id/modes', params: IdParams }, async ({ user, params }): Promise<ModeList> => {
    const rows = await read(user.id, (sql) =>
      sql.query<{ id: string; slug: string; name: string; spec: unknown; version: number }>(
        `select distinct on (m.id) m.id, m.slug, m.name, mv.spec, mv.version
         from modes m join packs p on p.id = m.pack_id join mode_versions mv on mv.mode_id = m.id
         where p.domain_id = $1 and mv.published_at is not null
         order by m.id, mv.version desc`,
        [params.id],
      ),
    );
    return {
      items: rows
        .map((r) => ({ id: r.id, slug: r.slug, name: r.name, latestVersion: r.version, stageKinds: ModeSpec.parse(r.spec).stages.map((s) => s.kind) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  });

  route({ method: 'GET', url: '/v1/modes/:id', params: IdParams }, async ({ user, params }): Promise<ModeDetail> => {
    const row = await read(user.id, (sql) => latestModeRow(sql, params.id));
    if (!row) throw notFound('mode');
    return {
      id: row.mode_id, slug: row.mode_slug, name: row.mode_name, domainId: row.domain_id,
      versionId: row.mode_version_id, version: row.version, spec: ModeSpec.parse(row.spec), publishedAt: iso(row.published_at),
    };
  });

  route({ method: 'GET', url: '/v1/languages' }, async ({ user }): Promise<LanguageList> => ({
    items: await read(user.id, (sql) => sql.query('select id, slug from languages order by slug')),
  }));

  // Authoring writes catalog rows with the service connection, after the role check.
  route({ method: 'POST', url: '/v1/packs', body: CreatePackRequest, roles: ['pack_author'] }, async ({ user, body, req, reply }): Promise<Pack> =>
    idempotent(db, user.id, req, reply, 201, () =>
      db.tx(async (sql) => {
        const [row] = await sql.query<{ id: string; domain_id: string; slug: string; name: string }>(
          `insert into packs (domain_id, slug, name) values ($1, $2, $3)
           on conflict (domain_id, slug) do nothing returning id, domain_id, slug, name`,
          [body.domainId, body.slug, body.name],
        );
        if (!row) throw new AppError(409, 'conflict', 'Conflict', 'pack slug already exists in this domain');
        await sql.query(`insert into audit_log (actor_id, action, target_type, target_id) values ($1, 'pack.create', 'pack', $2)`, [user.id, row.id]);
        return { id: row.id, domainId: row.domain_id, slug: row.slug, name: row.name };
      }),
    ),
  );

  route(
    { method: 'POST', url: '/v1/packs/:id/versions', params: IdParams, body: CreatePackVersionRequest, roles: ['pack_author'] },
    async ({ user, params, body, reply }): Promise<PackVersion> => {
      checkPackContent(body.content, promptExists);
      const pv = await db.tx(async (sql) => {
        const [pack] = await sql.query('select id from packs where id = $1', [params.id]);
        if (!pack) throw notFound('pack');
        const [row] = await sql.query<{ id: string; pack_id: string; version: number; published_at: Date | null; content_hash: string | null }>(
          `insert into pack_versions (pack_id, version) values ($1, $2)
           on conflict (pack_id, version) do nothing returning id, pack_id, version, published_at, content_hash`,
          [params.id, body.version],
        );
        if (!row) throw new AppError(409, 'conflict', 'Conflict', 'pack version already exists');
        await insertPackContent(sql, params.id, row.id, body.content);
        await sql.query(`insert into audit_log (actor_id, action, target_type, target_id) values ($1, 'pack_version.create', 'pack_version', $2)`, [user.id, row.id]);
        return toPackVersion(row);
      });
      reply.status(201);
      return pv;
    },
  );

  route(
    { method: 'POST', url: '/v1/pack-versions/:id/publish', params: IdParams, roles: ['pack_author'] },
    async ({ user, params }): Promise<PackVersion> =>
      db.tx(async (sql) => {
        const [exists] = await sql.query('select 1 from pack_versions where id = $1 for update', [params.id]);
        if (!exists) throw notFound('pack version');
        await sql.query('select publish_pack_version($1)', [params.id]);
        await sql.query(`insert into audit_log (actor_id, action, target_type, target_id) values ($1, 'pack_version.publish', 'pack_version', $2)`, [user.id, params.id]);
        const [row] = await sql.query<{ id: string; pack_id: string; version: number; published_at: Date | null; content_hash: string | null }>(
          'select id, pack_id, version, published_at, content_hash from pack_versions where id = $1',
          [params.id],
        );
        return toPackVersion(row!);
      }),
  );
}
