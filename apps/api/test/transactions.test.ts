import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestApp, seeded, type TestApp, type TestUser } from './helpers/app';
import { answer, getState, runToCompletion, startSession } from './helpers/flows';

/** A failure part-way through a transaction leaves no partial writes, and the retry converges. */
let t: TestApp;
let u: TestUser;
let modeId: string;
beforeAll(async () => {
  t = await createTestApp();
  modeId = (await seeded(t.db)).mode('case-interview');
  u = await t.user();
});
afterAll(() => t.close());

const count = async (sql: string, params: unknown[]) => (await t.db.query<{ n: number }>(sql, params))[0]!.n;

describe('turn append + state transition', () => {
  test('failure after appending the candidate turn rolls the append back', async () => {
    const s = await startSession(t, u, modeId);
    const { nextSeq } = await getState(t, u, s.id);
    t.db.failNext(/update sessions set status = 'processing'/);
    const payload = { seq: nextSeq, content: { type: 'text', text: 'answer' } };
    const res = await t.call(u, { method: 'POST', url: `/v1/sessions/${s.id}/turns`, payload });
    expect(res.statusCode).toBe(500);
    expect(await count(`select count(*)::int as n from turns where session_id = $1 and actor = 'candidate'`, [s.id])).toBe(0);
    const st = await getState(t, u, s.id);
    expect(st.status).toBe('awaiting_answer');
    expect(st.nextSeq).toBe(nextSeq);
    expect((await t.call(u, { method: 'POST', url: `/v1/sessions/${s.id}/turns`, payload })).statusCode).toBe(200);
  });

  test('failure while committing a stage change rolls back the stage, the next question and the job', async () => {
    const s = await startSession(t, u, modeId);
    const { nextSeq } = await getState(t, u, s.id);
    const before = await count(`select count(*)::int as n from jobs where name = 'evaluate_stage'`, []);
    // Stage 0 completes on this answer; fail the step that activates stage 1 (after stage 0 was marked done and the job enqueued).
    t.db.failNext(/update stage_runs set status = 'active'/);
    const payload = { seq: nextSeq, content: { type: 'text', text: 'answer' } };
    expect((await t.call(u, { method: 'POST', url: `/v1/sessions/${s.id}/turns`, payload })).statusCode).toBe(500);

    const runs = await t.db.query<{ status: string }>('select status from stage_runs where session_id = $1 order by idx', [s.id]);
    expect(runs.map((r) => r.status)).toEqual(['active', 'pending', 'pending']);
    expect(await count(`select count(*)::int as n from jobs where name = 'evaluate_stage'`, [])).toBe(before);
    expect(await count(`select count(*)::int as n from turns where session_id = $1 and actor = 'interviewer'`, [s.id])).toBe(1);
    // Phase 1 committed: the answer is stored and the session waits in processing for the retry.
    const st = await getState(t, u, s.id);
    expect(st.status).toBe('processing');

    const retry = await t.call(u, { method: 'POST', url: `/v1/sessions/${s.id}/turns`, payload });
    expect(retry.statusCode).toBe(200);
    expect(retry.json.state.currentStage.idx).toBe(1);
    expect(await count(`select count(*)::int as n from jobs where name = 'evaluate_stage'`, [])).toBe(before + 1);
  });

  test('failure while completing the session leaves it uncompleted with no finalize job', async () => {
    const s = await startSession(t, u, modeId);
    for (let i = 0; i < 5; i++) await answer(t, u, s.id);
    const st = await getState(t, u, s.id);
    expect(st.currentStage!.idx).toBe(2);
    t.db.failNext(/select enqueue_job/);
    const payload = { seq: st.nextSeq, content: { type: 'text', text: 'last answer' } };
    expect((await t.call(u, { method: 'POST', url: `/v1/sessions/${s.id}/turns`, payload })).statusCode).toBe(500);
    expect((await getState(t, u, s.id)).status).toBe('processing');
    expect(await count(`select count(*)::int as n from jobs where singleton_key = $1`, [`finalize_evaluation:${s.id}`])).toBe(0);
    const retry = await t.call(u, { method: 'POST', url: `/v1/sessions/${s.id}/turns`, payload });
    expect(retry.json.state.status).toBe('completed');
    expect(await count(`select count(*)::int as n from jobs where singleton_key = $1`, [`finalize_evaluation:${s.id}`])).toBe(1);
  });
});

describe('evaluation finalize', () => {
  test('a failure part-way through finalize writes no scores, report or summary; the retry completes once', async () => {
    const s = await startSession(t, u, modeId);
    await runToCompletion(t, u, s.id);
    const stageRuns = await t.db.query<{ id: string }>('select id from stage_runs where session_id = $1 order by idx', [s.id]);
    for (const r of stageRuns) await t.jobs.evaluate_stage({ stageRunId: r.id });

    t.db.failNext(/insert into reports/);
    await expect(t.jobs.finalize_evaluation({ sessionId: s.id })).rejects.toThrow(/injected/);
    const [ev] = await t.db.query<{ id: string; status: string }>('select id, status from evaluations where session_id = $1', [s.id]);
    expect(ev!.status).toBe('pending');
    expect(await count('select count(*)::int as n from competency_scores where evaluation_id = $1', [ev!.id])).toBe(0);
    expect(await count('select count(*)::int as n from reports where evaluation_id = $1', [ev!.id])).toBe(0);
    expect(await count('select count(*)::int as n from session_summaries where session_id = $1', [s.id])).toBe(0);
    expect(await count(`select count(*)::int as n from readiness where user_id = $1 and streams ? 'interview'`, [u.id])).toBe(0);

    await t.jobs.finalize_evaluation({ sessionId: s.id });
    await t.jobs.finalize_evaluation({ sessionId: s.id }); // second run is a no-op
    expect((await t.db.query<{ status: string }>('select status from evaluations where id = $1', [ev!.id]))[0]!.status).toBe('ready');
    const scores = await count('select count(*)::int as n from competency_scores where evaluation_id = $1', [ev!.id]);
    expect(scores).toBeGreaterThan(0);
    expect(await count('select count(*)::int as n from reports where evaluation_id = $1', [ev!.id])).toBe(1);
    const report = await t.call(u, { method: 'GET', url: `/v1/sessions/${s.id}/report` });
    expect(report.statusCode).toBe(200);
  });

  test('evaluation and report are 202 pending until finalize has run', async () => {
    const s = await startSession(t, u, modeId);
    await runToCompletion(t, u, s.id);
    for (const path of ['evaluation', 'report']) {
      const res = await t.call(u, { method: 'GET', url: `/v1/sessions/${s.id}/${path}` });
      expect(res.statusCode).toBe(202);
      expect(res.json).toEqual({ status: 'pending' });
    }
    await t.drain();
    expect((await t.call(u, { method: 'GET', url: `/v1/sessions/${s.id}/evaluation` })).statusCode).toBe(200);
  });
});
