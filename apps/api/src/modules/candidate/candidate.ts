import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import {
  CreateResumeRequest,
  IdParams,
  MAX_RESUME_BYTES,
  PatchProfileRequest,
  type CreateResumeResponse,
  type Profile,
  type ReadinessList,
  type ReadinessStream,
  type Resume,
  type ResumeContentType,
} from '@ai-interview/shared';
import type { Db, Sql } from '../../db/db';
import { iso, isoOrNull } from '../../db/db';
import { AiFailure } from '../../ai/runner';
import { invalidState, notFound } from '../../http/errors';
import { idempotent } from '../../http/idempotency';
import type { Route } from '../../http/route';
import { enqueue } from '../../queue/queue';
import type { ObjectStore } from '../../storage/object-store';
import { track } from '../analytics/analytics';
import { sniffMatches, type Extractor } from './extractor';
import type { GroundedProfile, Profiler } from './profiler';
import { recomputeResumeStream } from './readiness';

type ResumeRow = {
  id: string; user_id: string; object_key: string; file_name: string; content_type: ResumeContentType; size_bytes: number;
  status: Resume['status']; error: string | null; parsed_at: Date | null; created_at: Date;
};

const toResume = (r: ResumeRow): Resume => ({
  id: r.id, status: r.status, fileName: r.file_name, createdAt: iso(r.created_at), parsedAt: isoOrNull(r.parsed_at), error: r.error,
});

export async function loadProfile(sql: Sql, userId: string): Promise<Profile | null> {
  const [p] = await sql.query<{ id: string; headline: string | null; summary: string | null; source_resume_id: string | null }>(
    'select id, headline, summary, source_resume_id from profiles where user_id = $1',
    [userId],
  );
  if (!p) return null;
  const [experiences, education, skills] = await Promise.all([
    sql.query<{ org: string; title: string; start_date: string | null; end_date: string | null; description: string | null }>(
      'select org, title, start_date, end_date, description from experiences where profile_id = $1 order by created_at, id', [p.id]),
    sql.query<{ institution: string; degree: string | null; field: string | null; start_date: string | null; end_date: string | null }>(
      'select institution, degree, field, start_date, end_date from education where profile_id = $1 order by created_at, id', [p.id]),
    sql.query<{ skill_id: string | null; name: string; claimed_level: number | null; source: 'resume' | 'manual'; evidence: string[] }>(
      `select ps.skill_id, coalesce(s.name, ps.raw_name) as name, ps.claimed_level, ps.source, ps.evidence
       from profile_skills ps left join skills s on s.id = ps.skill_id where ps.profile_id = $1 order by name`, [p.id]),
  ]);
  return {
    id: p.id, headline: p.headline, summary: p.summary, sourceResumeId: p.source_resume_id,
    experiences: experiences.map((e) => ({ org: e.org, title: e.title, start: e.start_date, end: e.end_date, description: e.description })),
    education: education.map((e) => ({ institution: e.institution, degree: e.degree, field: e.field, start: e.start_date, end: e.end_date })),
    skills: skills.map((s) => ({ skillId: s.skill_id, name: s.name, claimedLevel: s.claimed_level, source: s.source, evidence: s.evidence })),
  };
}

/**
 * What the interviewer may know about the candidate, so questions can be built on their real resume:
 * headline, summary, roles and projects, education and skills with the resume line that evidences each.
 * All of it is candidate-authored, so it is passed as untrusted data and capped to a fixed size.
 */
export async function profileSummary(sql: Sql, userId: string): Promise<string> {
  const p = await loadProfile(sql, userId);
  if (!p) return 'No profile available. The candidate has not uploaded a resume, so ask about their background in general terms.';
  return renderProfileSummary(p);
}

type SummarySource = Pick<Profile, 'headline' | 'summary' | 'experiences' | 'education'> & { skills: { name: string; evidence: string[] }[] };

/** Projects are stored as experience rows whose title is the resume section heading, e.g. "Projects". */
export const isProject = (e: { title: string }) => /^(?:[a-z]+ )?projects?$/i.test(e.title.trim());

export function renderProfileSummary(p: SummarySource): string {
  const when = (a: string | null, b: string | null) => (a || b ? ` (${a ?? '?'} to ${b ?? 'present'})` : '');
  const list = (title: string, lines: string[]) => (lines.length ? `${title}:\n${lines.join('\n')}` : '');
  const parts = [
    p.headline ? `Headline: ${p.headline}` : '',
    p.summary ? `Summary: ${p.summary}` : '',
    list('Experience and projects', p.experiences.slice(0, 10).map((e) => `- ${isProject(e) ? `Project "${e.org}"` : `${e.title} at ${e.org}`}${when(e.start, e.end)}${e.description ? `: ${e.description.slice(0, 500)}` : ''}`)),
    list('Education', p.education.slice(0, 4).map((e) => `- ${[e.degree, e.field].filter(Boolean).join(', ') || 'Studies'} at ${e.institution}`)),
    list('Skills (with the resume line that supports each)', p.skills.slice(0, 25).map((s) => `- ${s.name}${s.evidence[0] ? `: "${s.evidence[0].slice(0, 160)}"` : ''}`)),
  ].filter(Boolean);
  return (parts.join('\n\n') || 'The profile is empty.').slice(0, 6000);
}

async function saveProfile(sql: Sql, userId: string, resumeId: string, g: GroundedProfile) {
  const [p] = await sql.query<{ id: string }>(
    `insert into profiles (user_id, headline, summary, source_resume_id) values ($1, $2, $3, $4)
     on conflict (user_id) do update set headline = $2, summary = $3, source_resume_id = $4 returning id`,
    [userId, g.headline, g.summary, resumeId],
  );
  const profileId = p!.id;
  await sql.query('delete from experiences where profile_id = $1', [profileId]);
  await sql.query('delete from education where profile_id = $1', [profileId]);
  await sql.query(`delete from profile_skills where profile_id = $1 and source = 'resume'`, [profileId]);
  for (const e of g.experiences) {
    await sql.query(
      'insert into experiences (profile_id, user_id, org, title, start_date, end_date, description) values ($1, $2, $3, $4, $5, $6, $7)',
      [profileId, userId, e.org, e.title, e.start, e.end, e.description],
    );
  }
  for (const e of g.education) {
    await sql.query(
      'insert into education (profile_id, user_id, institution, degree, field, start_date, end_date) values ($1, $2, $3, $4, $5, $6, $7)',
      [profileId, userId, e.institution, e.degree, e.field, e.start, e.end],
    );
  }
  // Normalization: exact alias match against the taxonomy. Unmatched names stay raw (skill_id null) for pack authors.
  const aliases = await sql.query<{ alias: string; skill_id: string }>(
    'select alias, skill_id from skill_aliases where alias = any($1::text[])',
    [g.skills.map((s) => s.name.trim().toLowerCase())],
  );
  const byAlias = new Map(aliases.map((a) => [a.alias, a.skill_id]));
  for (const s of g.skills) {
    await sql.query(
      `insert into profile_skills (profile_id, user_id, skill_id, raw_name, claimed_level, evidence, source) values ($1, $2, $3, $4, $5, $6, 'resume')`,
      [profileId, userId, byAlias.get(s.name.trim().toLowerCase()) ?? null, s.name, s.level, JSON.stringify(s.evidence)],
    );
  }
}

export function createResumeParser(deps: { db: Db; store: ObjectStore; extract: Extractor; profiler: Profiler; log: FastifyBaseLogger }) {
  const { db, store, extract, profiler, log } = deps;
  const fail = (id: string, error: string) => db.query(`update resumes set status = 'failed', error = $2 where id = $1`, [id, error]);

  return async function parseResume({ resumeId }: { resumeId: string }) {
    const [r] = await db.query<ResumeRow>(`update resumes set status = 'parsing' where id = $1 and status in ('uploaded', 'parsing') returning *`, [resumeId]);
    if (!r) return;
    // The declared size is the contract: a client cannot declare a small file and upload a larger one.
    const bytes = await store.get(r.object_key, Math.min(MAX_RESUME_BYTES, r.size_bytes)).catch(() => undefined);
    if (bytes === undefined) return void (await fail(r.id, 'file exceeds the size limit or could not be read'));
    if (bytes === null) return void (await fail(r.id, 'file was not uploaded'));
    if (!sniffMatches(bytes, r.content_type)) return void (await fail(r.id, 'file content does not match its declared type'));
    const text = await extract(bytes, r.content_type).catch(() => '');
    if (text.trim().length < 20) return void (await fail(r.id, 'no readable text found'));

    let grounded: GroundedProfile;
    try {
      ({ profile: grounded } = await profiler.extract({ userId: r.user_id }, text));
    } catch (err) {
      if (err instanceof AiFailure) return void (await fail(r.id, 'profile extraction failed'));
      throw err;
    }
    log.info({ resumeId: r.id, dropped: grounded.dropped }, 'resume parsed');
    await db.tx(async (sql) => {
      await saveProfile(sql, r.user_id, r.id, grounded);
      await sql.query(`update resumes set status = 'parsed', parsed_at = now(), error = null where id = $1`, [r.id]);
      await recomputeResumeStream(sql, r.user_id);
      await track(sql, r.user_id, 'resume_parsed', { resumeId: r.id, skills: grounded.skills.length });
      await enqueue(sql, 'recommend', { userId: r.user_id, evaluationId: null });
    });
  };
}

export function candidateRoutes(route: Route, deps: { db: Db; store: ObjectStore }) {
  const { db, store } = deps;

  route({ method: 'POST', url: '/v1/resumes', body: CreateResumeRequest }, async ({ user, body, req, reply }): Promise<CreateResumeResponse> =>
    idempotent(db, user.id, req, reply, 201, async () => {
      const objectKey = `${user.id}/${randomUUID()}`;
      const upload = await store.createUploadUrl(objectKey, body.contentType);
      const [row] = await db.asUser(user.id, (sql) =>
        sql.query<{ id: string }>(
          'insert into resumes (user_id, object_key, file_name, content_type, size_bytes) values ($1, $2, $3, $4, $5) returning id',
          [user.id, objectKey, body.fileName, body.contentType, body.sizeBytes],
        ),
      );
      return { resumeId: row!.id, uploadUrl: upload.url, uploadHeaders: upload.headers, expiresAt: upload.expiresAt.toISOString() };
    }),
  );

  route({ method: 'POST', url: '/v1/resumes/:id/complete', params: IdParams }, async ({ user, params, reply }): Promise<Resume> => {
    const resume = await db.asUser(user.id, async (sql) => {
      const [moved] = await sql.query<ResumeRow>(
        `update resumes set status = 'uploaded', error = null where id = $1 and status in ('awaiting_upload', 'failed') returning *`,
        [params.id],
      );
      if (moved) {
        await enqueue(sql, 'parse_resume', { resumeId: moved.id });
        return moved;
      }
      const [current] = await sql.query<ResumeRow>('select * from resumes where id = $1', [params.id]);
      if (!current) throw notFound('resume');
      return current; // already uploaded or parsed: a retried complete is a no-op
    });
    reply.status(202);
    return toResume(resume);
  });

  route({ method: 'GET', url: '/v1/resumes/:id', params: IdParams }, async ({ user, params }): Promise<Resume> => {
    const [r] = await db.asUser(user.id, (sql) => sql.query<ResumeRow>('select * from resumes where id = $1', [params.id]));
    if (!r) throw notFound('resume');
    return toResume(r);
  });

  route({ method: 'GET', url: '/v1/profile' }, async ({ user }): Promise<Profile> => {
    const p = await db.asUser(user.id, (sql) => loadProfile(sql, user.id));
    if (!p) throw notFound('profile');
    return p;
  });

  route({ method: 'PATCH', url: '/v1/profile', body: PatchProfileRequest }, async ({ user, body }): Promise<Profile> =>
    db.asUser(user.id, async (sql) => {
      await sql.query(
        `insert into profiles (user_id, headline, summary) values ($1, $2, $3)
         on conflict (user_id) do update set
           headline = case when $4 then excluded.headline else profiles.headline end,
           summary = case when $5 then excluded.summary else profiles.summary end`,
        [user.id, body.headline ?? null, body.summary ?? null, 'headline' in body, 'summary' in body],
      );
      const p = await loadProfile(sql, user.id);
      if (!p) throw invalidState('profile write failed');
      return p;
    }),
  );

  route({ method: 'GET', url: '/v1/readiness' }, async ({ user }): Promise<ReadinessList> => {
    const rows = await db.asUser(user.id, (sql) =>
      sql.query<{ competency_id: string; slug: string; name: string; score: number; confidence: number; streams: Record<string, unknown>; updated_at: Date }>(
        `select r.competency_id, c.slug, c.name, r.score, r.confidence, r.streams, r.updated_at
         from readiness r join competencies c on c.id = r.competency_id where r.user_id = $1 order by c.name`,
        [user.id],
      ),
    );
    return {
      items: rows.map((r) => ({
        competencyId: r.competency_id, competencySlug: r.slug, competencyName: r.name, score: r.score, confidence: r.confidence,
        streams: Object.keys(r.streams) as ReadinessStream[], updatedAt: iso(r.updated_at),
      })),
    };
  });
}
