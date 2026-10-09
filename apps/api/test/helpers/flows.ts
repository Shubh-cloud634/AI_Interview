import { expect } from 'vitest';
import type { TestApp, TestUser } from './app';

/** Starts a session and returns it with its first state. */
export async function startSession(t: TestApp, u: TestUser, modeId: string) {
  const res = await t.call(u, { method: 'POST', url: '/v1/sessions', payload: { modeId } });
  expect(res.statusCode, res.body).toBe(201);
  return res.json as { id: string; status: string; stages: { id: string; kind: string; status: string }[] };
}

export async function getState(t: TestApp, u: TestUser, sessionId: string) {
  const res = await t.call(u, { method: 'GET', url: `/v1/sessions/${sessionId}/state` });
  expect(res.statusCode, res.body).toBe(200);
  return res.json as { status: string; nextSeq: number; currentStage: { id: string; kind: string; idx: number } | null; turns: unknown[] };
}

/** Submits one text answer at the current nextSeq. */
export async function answer(t: TestApp, u: TestUser, sessionId: string, text = 'I would structure the problem into revenue and cost drivers first.') {
  const s = await getState(t, u, sessionId);
  const res = await t.call(u, { method: 'POST', url: `/v1/sessions/${sessionId}/turns`, payload: { seq: s.nextSeq, content: { type: 'text', text } } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json as { interviewerTurn: { content: { type: string } } | null; state: { status: string; nextSeq: number; currentStage: { idx: number; kind: string } | null } };
}

/** Answers with text until the session completes. Every kind in the seeded packs accepts text. */
export async function runToCompletion(t: TestApp, u: TestUser, sessionId: string, maxTurns = 30) {
  const kinds: string[] = [];
  for (let i = 0; i < maxTurns; i++) {
    const s = await getState(t, u, sessionId);
    if (s.status === 'completed') return { turns: i, kinds };
    kinds.push(s.currentStage!.kind);
    await answer(t, u, sessionId, `Answer number ${i + 1}: I would size the market from population, adoption and price, then check the unit economics.`);
  }
  throw new Error('session did not complete');
}

/** Session through to a stored report (stage evaluations, finalize, recommend). */
export async function completedWithReport(t: TestApp, u: TestUser, modeId: string) {
  const session = await startSession(t, u, modeId);
  await runToCompletion(t, u, session.id);
  await t.drain();
  const report = await t.call(u, { method: 'GET', url: `/v1/sessions/${session.id}/report` });
  expect(report.statusCode, report.body).toBe(200);
  return { session, report: report.json };
}
