import type { ReadinessStream } from '@ai-interview/shared';
import type { Sql } from '../../db/db';

export interface StreamValue {
  score: number;
  confidence: number;
  at: string;
}
export type Streams = Partial<Record<ReadinessStream, StreamValue>>;

/** Resume claims are unverified, so they count for a quarter of observed evidence. */
const STREAM_WEIGHT: Record<ReadinessStream, number> = { resume: 0.25, interview: 1, coding: 1 };
const HALF_LIFE_DAYS = 120;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function decay(at: string, now: Date): number {
  const days = Math.max(0, (now.getTime() - new Date(at).getTime()) / 86_400_000);
  return 0.5 ** (days / HALF_LIFE_DAYS);
}

/** The readiness vector entry for one competency, from its evidence streams. */
export function combine(streams: Streams, now: Date): { score: number; confidence: number } {
  let num = 0;
  let den = 0;
  let miss = 1;
  for (const [name, v] of Object.entries(streams) as [ReadinessStream, StreamValue][]) {
    const w = STREAM_WEIGHT[name] * v.confidence * decay(v.at, now);
    num += w * v.score;
    den += w;
    miss *= 1 - clamp01(w);
  }
  return { score: den > 0 ? clamp01(num / den) : 0, confidence: clamp01(1 - miss) };
}

/** Folds a new observation into a stream; older evidence decays before it is weighed. */
export function observe(prev: StreamValue | undefined, obs: { score: number; confidence: number }, now: Date): StreamValue {
  if (!prev) return { score: clamp01(obs.score), confidence: clamp01(obs.confidence), at: now.toISOString() };
  const pw = prev.confidence * decay(prev.at, now);
  const total = pw + obs.confidence;
  return {
    score: total > 0 ? clamp01((prev.score * pw + obs.score * obs.confidence) / total) : prev.score,
    confidence: clamp01(1 - (1 - pw) * (1 - obs.confidence)),
    at: now.toISOString(),
  };
}

async function write(sql: Sql, userId: string, competencyId: string, streams: Streams, now: Date) {
  if (Object.keys(streams).length === 0) {
    await sql.query('delete from readiness where user_id = $1 and competency_id = $2', [userId, competencyId]);
    return;
  }
  const { score, confidence } = combine(streams, now);
  await sql.query(
    `insert into readiness (user_id, competency_id, score, confidence, streams, updated_at) values ($1, $2, $3, $4, $5, $6)
     on conflict (user_id, competency_id) do update set score = $3, confidence = $4, streams = $5, updated_at = $6`,
    [userId, competencyId, score, confidence, JSON.stringify(streams), now],
  );
}

async function currentStreams(sql: Sql, userId: string): Promise<Map<string, Streams>> {
  const rows = await sql.query<{ competency_id: string; streams: Streams }>(
    'select competency_id, streams from readiness where user_id = $1 for update',
    [userId],
  );
  return new Map(rows.map((r) => [r.competency_id, r.streams]));
}

/** Replaces the resume stream from the current profile skills. Idempotent: re-parsing does not double count. */
export async function recomputeResumeStream(sql: Sql, userId: string, now = new Date()) {
  const claims = await sql.query<{ competency_id: string; score: number }>(
    `select sc.competency_id, sum(sc.weight * coalesce(ps.claimed_level, 3) / 5.0) / sum(sc.weight) as score
     from profile_skills ps join skill_competencies sc on sc.skill_id = ps.skill_id
     where ps.user_id = $1 group by sc.competency_id`,
    [userId],
  );
  const existing = await currentStreams(sql, userId);
  const claimed = new Map(claims.map((c) => [c.competency_id, Number(c.score)]));
  for (const id of new Set([...existing.keys(), ...claimed.keys()])) {
    const streams: Streams = { ...existing.get(id) };
    const score = claimed.get(id);
    if (score === undefined) delete streams.resume;
    else streams.resume = { score, confidence: 0.5, at: now.toISOString() };
    await write(sql, userId, id, streams, now);
  }
}

export async function recordEvidence(
  sql: Sql,
  userId: string,
  stream: Exclude<ReadinessStream, 'resume'>,
  observations: { competencyId: string; score: number; confidence: number }[],
  now = new Date(),
) {
  const existing = await currentStreams(sql, userId);
  for (const o of observations) {
    const streams: Streams = { ...existing.get(o.competencyId) };
    streams[stream] = observe(streams[stream], o, now);
    await write(sql, userId, o.competencyId, streams, now);
  }
}
