import { randomInt } from 'node:crypto';
import {
  CandidateContent,
  InterviewerContent,
  KIND_CONTENT,
  type CreateSessionRequest,
  type QuestionView,
  type Session,
  type SessionState,
  type StageKind,
  type StageRun,
  type StageSpec,
  type SubmitTurnRequest,
  type SubmitTurnResponse,
  type Turn,
} from '@ai-interview/shared';
import type { Db, Sql } from '../../db/db';
import { iso, isoOrNull } from '../../db/db';
import { AppError, conflict, invalidState, notFound } from '../../http/errors';
import { enqueue } from '../../queue/queue';
import { track } from '../analytics/analytics';
import { profileSummary } from '../candidate/candidate';
import { bankQuestions, getModeVersion, latestModeVersion, questionBody, resolveRubric, type ModeVersion } from '../catalog/catalog';
import { enqueueGradedRun } from '../sandbox/sandbox';
import type { SessionBus } from './events';
import type { Interviewer, TranscriptLine } from './interviewer';
import { nextStep, run, type EngineState } from './machine';
import { selectQuestion, type QuestionRef } from './select';

type SessionRow = {
  id: string; user_id: string; mode_version_id: string; target_role_id: string | null; status: Session['status'];
  stage_idx: number | null; last_seq: number; seed: number; started_at: Date | null; ended_at: Date | null; created_at: Date;
};
type StageRunRow = {
  id: string; session_id: string; stage_id: string; kind: StageKind; idx: number; status: StageRun['status'];
  question_ref: QuestionRef | null; started_at: Date | null; ended_at: Date | null;
};
type TurnRow = { seq: number; actor: Turn['actor']; content: unknown; created_at: Date; stage_idx: number; stage_run_id: string };

const TURN_SELECT = `select t.seq, t.actor, t.content, t.created_at, sr.idx as stage_idx, t.stage_run_id
  from turns t join stage_runs sr on sr.id = t.stage_run_id`;

const toTurn = (r: TurnRow): Turn => ({
  seq: r.seq,
  stageIdx: r.stage_idx,
  actor: r.actor,
  content: r.actor === 'candidate' ? CandidateContent.parse(r.content) : InterviewerContent.parse(r.content),
  createdAt: iso(r.created_at),
});

export function deadlineOf(startedAt: Date | null, stage: StageSpec | undefined): Date | null {
  if (!startedAt || !stage?.timeLimitSec) return null;
  return new Date(new Date(startedAt).getTime() + stage.timeLimitSec * 1000);
}

/** Order-insensitive equality for JSON values (jsonb does not keep key order). */
function sameJson(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(norm) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y)).map(([k, x]) => [k, norm(x)])) : v;
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

export function toQuestionView(body: Awaited<ReturnType<typeof questionBody>>): QuestionView {
  return {
    title: body.title,
    prompt: body.prompt,
    exhibits: body.exhibits,
    starterCode: body.starterCode,
    visibleTests: body.tests?.visible.map((t) => ({ name: t.name, input: t.input, expected: t.expected })),
  };
}

/** Interview engine. Holds no in-memory session state; every transition is a DB transaction keyed by seq. */
export function createEngine(deps: { db: Db; interviewer: Interviewer; bus: SessionBus }) {
  const { db, interviewer, bus } = deps;

  async function loadSession(sql: Sql, id: string, lock = false): Promise<SessionRow> {
    const [s] = await sql.query<SessionRow>(`select * from sessions where id = $1${lock ? ' for update' : ''}`, [id]);
    if (!s) throw notFound('session');
    return s;
  }

  const stageRuns = (sql: Sql, sessionId: string) =>
    sql.query<StageRunRow>('select * from stage_runs where session_id = $1 order by idx', [sessionId]);

  function toStageRun(r: StageRunRow, mv: ModeVersion): StageRun {
    const spec = mv.spec.stages[r.idx];
    return {
      id: r.id, stageId: r.stage_id, kind: r.kind, idx: r.idx, status: r.status, timeLimitSec: spec?.timeLimitSec ?? null,
      startedAt: isoOrNull(r.started_at), deadlineAt: isoOrNull(deadlineOf(r.started_at, spec)), endedAt: isoOrNull(r.ended_at),
    };
  }

  async function sessionView(sql: Sql, s: SessionRow): Promise<Session> {
    const mv = await getModeVersion(sql, s.mode_version_id);
    const runs = await stageRuns(sql, s.id);
    return {
      id: s.id, status: s.status, modeId: mv.modeId, modeVersionId: mv.modeVersionId, modeName: mv.modeName,
      targetRoleId: s.target_role_id, currentStageIdx: s.stage_idx, stages: runs.map((r) => toStageRun(r, mv)),
      startedAt: isoOrNull(s.started_at), endedAt: isoOrNull(s.ended_at), createdAt: iso(s.created_at),
    };
  }

  async function stateView(sql: Sql, s: SessionRow): Promise<SessionState> {
    const now = new Date();
    const base = { sessionId: s.id, status: s.status, nextSeq: s.last_seq + 1, serverTime: now.toISOString() };
    const terminal = s.status === 'completed' || s.status === 'abandoned';
    if (terminal || s.stage_idx === null) return { ...base, currentStage: null, question: null, turns: [], remainingSec: null };
    const mv = await getModeVersion(sql, s.mode_version_id);
    const [sr] = await sql.query<StageRunRow>('select * from stage_runs where session_id = $1 and idx = $2', [s.id, s.stage_idx]);
    const turns = (await sql.query<TurnRow>(`${TURN_SELECT} where t.stage_run_id = $1 order by t.seq`, [sr!.id])).map(toTurn);
    const first = turns.find((t) => t.content.type === 'question');
    const deadline = deadlineOf(sr!.started_at, mv.spec.stages[sr!.idx]);
    return {
      ...base,
      currentStage: toStageRun(sr!, mv),
      question: first && first.content.type === 'question' ? first.content.question : null,
      turns,
      remainingSec: deadline ? Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / 1000)) : null,
    };
  }

  /** DB reads for choosing a stage's question. Generated questions still need an AI call afterwards. */
  async function prepareQuestion(sql: Sql, userId: string, mv: ModeVersion, stageIdx: number, seed: number, sessionId: string | null) {
    const stage = mv.spec.stages[stageIdx]!;
    const rubric = await resolveRubric(sql, mv.packVersionId, stage.rubricRef);
    const [r] = await sql.query<{ avg: number | null }>(
      'select avg(score) as avg from readiness where user_id = $1 and competency_id = any($2::uuid[])',
      [userId, rubric.criteria.map((c) => c.competencyId)],
    );
    const asked = await sql.query<{ id: string }>(
      `select question_ref ->> 'templateId' as id from stage_runs where user_id = $1 and question_ref ->> 'type' = 'bank'`,
      [userId],
    );
    const bank = stage.questionSource.type === 'bank' ? await bankQuestions(sql, mv.packVersionId, stage.kind, stage.questionSource.tags) : [];
    const ref = selectQuestion({
      stage, adaptivity: mv.spec.adaptivity, readiness: r?.avg ?? null,
      askedTemplateIds: new Set(asked.map((a) => a.id)), bank, seed, stageIdx,
    });
    if (ref.type === 'bank') return { stage, ref, view: toQuestionView(await questionBody(sql, ref.templateId)), ai: null };
    const previous = sessionId
      ? (await sql.query<{ content: { question: QuestionView } }>(
          `select content from turns where session_id = $1 and content ->> 'type' = 'question' order by seq`, [sessionId],
        )).map((t) => t.content.question.prompt)
      : [];
    return { stage, ref, view: null, ai: { profile: await profileSummary(sql, userId), previous } };
  }

  async function materialize(userId: string, p: Awaited<ReturnType<typeof prepareQuestion>>, onToken?: (d: string) => void): Promise<QuestionView> {
    if (p.view) return p.view;
    if (p.ref.type !== 'generated' || !p.ai) throw new Error('unreachable');
    const q = await interviewer.generateQuestion(
      { userId },
      { promptRef: p.ref.promptRef, kind: p.stage.kind, difficulty: p.ref.difficulty, profileSummary: p.ai.profile, previousQuestions: p.ai.previous },
      onToken,
    );
    return { prompt: q.text };
  }

  async function createSession(userId: string, body: CreateSessionRequest): Promise<Session> {
    const seed = randomInt(1, 2 ** 31 - 1);
    const { mv, prepared } = await db.asUser(userId, async (sql) => {
      const mv = await latestModeVersion(sql, body.modeId);
      if (!mv) throw notFound('mode');
      if (body.targetRoleId) {
        const [role] = await sql.query('select 1 from roles where id = $1', [body.targetRoleId]);
        if (!role) throw notFound('role');
      }
      return { mv, prepared: await prepareQuestion(sql, userId, mv, 0, seed, null) };
    });
    // The first question is generated before anything is written, so a failure leaves nothing half-created.
    const question = await materialize(userId, prepared);
    const state = run({ status: 'created', stageIdx: null }, ['start', 'ask'], mv.spec.stages.length);

    return db.asUser(userId, async (sql) => {
      const [s] = await sql.query<SessionRow>(
        `insert into sessions (user_id, mode_version_id, target_role_id, status, stage_idx, last_seq, seed, started_at)
         values ($1, $2, $3, $4, $5, 1, $6, now()) returning *`,
        [userId, mv.modeVersionId, body.targetRoleId ?? null, state.status, state.stageIdx, seed],
      );
      let firstRunId = '';
      for (const [idx, stage] of mv.spec.stages.entries()) {
        const [sr] = await sql.query<{ id: string }>(
          `insert into stage_runs (session_id, user_id, stage_id, kind, idx, status, question_ref, started_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
          [s!.id, userId, stage.id, stage.kind, idx, idx === 0 ? 'active' : 'pending', idx === 0 ? JSON.stringify(prepared.ref) : null, idx === 0 ? new Date() : null],
        );
        if (idx === 0) firstRunId = sr!.id;
      }
      await sql.query(`insert into turns (stage_run_id, session_id, user_id, seq, actor, content) values ($1, $2, $3, 1, 'interviewer', $4)`, [
        firstRunId, s!.id, userId, JSON.stringify({ type: 'question', question }),
      ]);
      await track(sql, userId, 'session_started', { sessionId: s!.id, modeVersionId: mv.modeVersionId });
      return sessionView(sql, s!);
    });
  }

  async function transcriptOf(sql: Sql, stageRunId: string): Promise<{ question: string; lines: TranscriptLine[] }> {
    const rows = await sql.query<TurnRow>(`${TURN_SELECT} where t.stage_run_id = $1 order by t.seq`, [stageRunId]);
    const lines: TranscriptLine[] = [];
    let question = '';
    for (const r of rows) {
      const t = toTurn(r);
      const c = t.content;
      if (c.type === 'question') question = c.question.prompt;
      let text: string;
      if (c.type === 'question') text = c.question.prompt;
      else if (c.type === 'follow_up') text = c.text;
      else if (c.type === 'text') text = c.text;
      else if (c.type === 'structured') text = JSON.stringify(c.fields);
      else {
        const [sub] = await sql.query<{ source: string }>('select source from code_submissions where id = $1', [c.submissionId]);
        text = `[code submission]\n${sub?.source ?? ''}`;
      }
      lines.push({ actor: t.actor, text });
    }
    return { question, lines };
  }

  async function replay(sql: Sql, s: SessionRow, seq: number): Promise<SubmitTurnResponse> {
    const rows = await sql.query<TurnRow>(`${TURN_SELECT} where t.session_id = $1 and t.seq in ($2, $3) order by t.seq`, [s.id, seq, seq + 1]);
    const candidate = rows.find((r) => r.seq === seq);
    const reply = rows.find((r) => r.seq === seq + 1);
    return { candidateTurn: toTurn(candidate!), interviewerTurn: reply ? toTurn(reply) : null, state: await stateView(sql, s), replayed: true };
  }

  async function submitTurn(userId: string, sessionId: string, req: SubmitTurnRequest): Promise<SubmitTurnResponse> {
    // Phase 1: append the candidate turn and move to processing, or detect a retry.
    const p1 = await db.asUser(userId, async (sql) => {
      const s = await loadSession(sql, sessionId, true);
      const [existing] = await sql.query<TurnRow>(`${TURN_SELECT} where t.session_id = $1 and t.seq = $2`, [sessionId, req.seq]);
      if (existing) {
        if (existing.actor !== 'candidate' || !sameJson(existing.content, req.content)) {
          throw conflict(`seq ${req.seq} is already used by a different turn`, { code: 'seq_conflict', expectedSeq: s.last_seq + 1 });
        }
        // Stuck in processing at this seq means an earlier attempt died mid-flight: resume it.
        if (!(s.status === 'processing' && s.last_seq === req.seq)) return { done: await replay(sql, s, req.seq) };
      } else {
        if (s.status !== 'awaiting_answer') throw invalidState(`session is ${s.status}`);
        if (req.seq !== s.last_seq + 1) {
          throw new AppError(409, 'seq_conflict', 'Sequence conflict', `expected seq ${s.last_seq + 1}`, { expectedSeq: s.last_seq + 1 });
        }
      }
      const mv = await getModeVersion(sql, s.mode_version_id);
      const stage = mv.spec.stages[s.stage_idx!]!;
      const [sr] = await sql.query<StageRunRow>('select * from stage_runs where session_id = $1 and idx = $2', [sessionId, s.stage_idx]);
      if (!existing) {
        if (!KIND_CONTENT[stage.kind].includes(req.content.type)) {
          throw new AppError(400, 'validation_failed', 'Validation failed', `a ${stage.kind} stage does not accept ${req.content.type} answers`);
        }
        if (req.content.type === 'code') {
          const [sub] = await sql.query('select 1 from code_submissions where id = $1 and stage_run_id = $2', [req.content.submissionId, sr!.id]);
          if (!sub) throw new AppError(400, 'validation_failed', 'Validation failed', 'submission does not belong to the current stage');
          await enqueueGradedRun(sql, userId, req.content.submissionId);
        }
        run({ status: s.status, stageIdx: s.stage_idx }, ['answer'], mv.spec.stages.length);
        await sql.query(`insert into turns (stage_run_id, session_id, user_id, seq, actor, content) values ($1, $2, $3, $4, 'candidate', $5)`, [
          sr!.id, sessionId, userId, req.seq, JSON.stringify(req.content),
        ]);
        await sql.query(`update sessions set status = 'processing', last_seq = $2 where id = $1`, [sessionId, req.seq]);
      }
      const [{ n }] = (await sql.query<{ n: number }>(`select count(*)::int as n from turns where stage_run_id = $1 and actor = 'candidate'`, [sr!.id])) as [{ n: number }];
      const step = nextStep(stage, n, req.content);
      const nextIdx = s.stage_idx! + 1;
      const hasNext = nextIdx < mv.spec.stages.length;
      const prepared = step === 'complete_stage' && hasNext ? await prepareQuestion(sql, userId, mv, nextIdx, s.seed, sessionId) : null;
      const transcript = step === 'follow_up' ? await transcriptOf(sql, sr!.id) : null;
      const profile = step === 'follow_up' ? await profileSummary(sql, userId) : '';
      return { done: null, s, mv, stage, sr: sr!, step, prepared, transcript, profile };
    });
    if (p1.done) return p1.done;
    const { s, mv, stage, sr, step, prepared, transcript, profile } = p1;
    const replySeq = req.seq + 1;
    const onToken = (delta: string) => bus.publish(sessionId, { type: 'token', seq: replySeq, delta });

    // Phase 2: AI work outside any transaction. A failure leaves the session in processing for a retry.
    let reply: unknown = null;
    if (step === 'follow_up') {
      const f = await interviewer.followUp({ userId }, { kind: stage.kind, question: transcript!.question, transcript: transcript!.lines, profileSummary: profile }, onToken);
      reply = { type: 'follow_up', text: f.text };
    } else if (prepared) {
      reply = { type: 'question', question: await materialize(userId, prepared, onToken) };
    }

    // Phase 3: commit the transition if nobody else did.
    const result = await db.asUser(userId, async (sql) => {
      const cur = await loadSession(sql, sessionId, true);
      if (cur.status !== 'processing' || cur.last_seq !== req.seq) return replay(sql, cur, req.seq);
      const state: EngineState = { status: cur.status, stageIdx: cur.stage_idx };
      if (step === 'follow_up') {
        run(state, ['follow_up'], mv.spec.stages.length);
        await sql.query(`insert into turns (stage_run_id, session_id, user_id, seq, actor, content) values ($1, $2, $3, $4, 'interviewer', $5)`, [
          sr.id, sessionId, userId, replySeq, JSON.stringify(reply),
        ]);
        await sql.query(`update sessions set status = 'awaiting_answer', last_seq = $2 where id = $1`, [sessionId, replySeq]);
      } else {
        const after = run(state, ['complete_stage'], mv.spec.stages.length);
        await sql.query(`update stage_runs set status = 'completed', ended_at = now() where id = $1`, [sr.id]);
        await enqueue(sql, 'evaluate_stage', { stageRunId: sr.id }, { key: `evaluate_stage:${sr.id}` });
        await track(sql, userId, 'stage_completed', { sessionId, stageIdx: sr.idx, kind: sr.kind });
        if (after.status === 'in_stage' && prepared) {
          const asked = run(after, ['ask'], mv.spec.stages.length);
          const [next] = await sql.query<{ id: string }>(
            `update stage_runs set status = 'active', started_at = now(), question_ref = $3 where session_id = $1 and idx = $2 returning id`,
            [sessionId, asked.stageIdx, JSON.stringify(prepared.ref)],
          );
          await sql.query(`insert into turns (stage_run_id, session_id, user_id, seq, actor, content) values ($1, $2, $3, $4, 'interviewer', $5)`, [
            next!.id, sessionId, userId, replySeq, JSON.stringify(reply),
          ]);
          await sql.query('update sessions set status = $2, stage_idx = $3, last_seq = $4 where id = $1', [sessionId, asked.status, asked.stageIdx, replySeq]);
        } else {
          await sql.query(`update sessions set status = 'completed', ended_at = now() where id = $1`, [sessionId]);
          await enqueue(sql, 'finalize_evaluation', { sessionId }, { key: `finalize_evaluation:${sessionId}` });
          await track(sql, userId, 'session_completed', { sessionId });
        }
      }
      const fresh = await loadSession(sql, sessionId);
      const rows = await sql.query<TurnRow>(`${TURN_SELECT} where t.session_id = $1 and t.seq in ($2, $3) order by t.seq`, [sessionId, req.seq, replySeq]);
      const reply2 = rows.find((r) => r.seq === replySeq);
      return {
        candidateTurn: toTurn(rows.find((r) => r.seq === req.seq)!),
        interviewerTurn: reply2 ? toTurn(reply2) : null,
        state: await stateView(sql, fresh),
        replayed: false,
      } satisfies SubmitTurnResponse;
    });
    bus.publish(sessionId, { type: 'changed' });
    void s;
    return result;
  }

  async function end(userId: string, sessionId: string): Promise<Session> {
    const out = await db.asUser(userId, async (sql) => {
      const s = await loadSession(sql, sessionId, true);
      if (s.status === 'completed' || s.status === 'abandoned') return sessionView(sql, s);
      const mv = await getModeVersion(sql, s.mode_version_id);
      const after = run({ status: s.status, stageIdx: s.stage_idx }, ['end'], mv.spec.stages.length);
      await sql.query(`update sessions set status = $2, ended_at = now() where id = $1`, [sessionId, after.status]);
      await sql.query(`update stage_runs set status = 'skipped', ended_at = now() where session_id = $1 and status in ('pending', 'active')`, [sessionId]);
      await track(sql, userId, 'session_abandoned', { sessionId });
      return sessionView(sql, await loadSession(sql, sessionId));
    });
    bus.publish(sessionId, { type: 'changed' });
    return out;
  }

  return {
    createSession,
    submitTurn,
    end,
    getSession: (userId: string, id: string) => db.asUser(userId, async (sql) => sessionView(sql, await loadSession(sql, id))),
    getState: (userId: string, id: string) => db.asUser(userId, async (sql) => stateView(sql, await loadSession(sql, id))),
  };
}
export type Engine = ReturnType<typeof createEngine>;

/** For other modules (sandbox): the stage run, its spec and its deadline, read under the caller's RLS. */
export async function stageRunContext(sql: Sql, stageRunId: string) {
  const [row] = await sql.query<StageRunRow & { session_status: Session['status']; mode_version_id: string }>(
    `select sr.*, s.status as session_status, s.mode_version_id from stage_runs sr join sessions s on s.id = sr.session_id where sr.id = $1`,
    [stageRunId],
  );
  if (!row) return null;
  const mv = await getModeVersion(sql, row.mode_version_id);
  const stage = mv.spec.stages[row.idx];
  return {
    id: row.id, sessionId: row.session_id, kind: row.kind, status: row.status, sessionStatus: row.session_status,
    questionRef: row.question_ref, deadline: deadlineOf(row.started_at, stage),
  };
}
