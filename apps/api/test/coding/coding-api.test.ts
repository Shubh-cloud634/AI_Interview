import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_SOURCE_BYTES } from '@ai-interview/shared';
import { createTestApp, type TestApp, type TestUser } from '../helpers/app';
import {
  SECRET,
  createCodingMode,
  languageIds,
  lease,
  postResult,
  registerRunner,
  resultFor,
  setDeadline,
  signResult,
  startCodingSession,
  type TestRunner,
} from './fixture';

let app: TestApp;
let modeId: string;
let lang: Record<string, string>;
let runner: TestRunner;

beforeAll(async () => {
  app = await createTestApp();
  modeId = await createCodingMode(app.db);
  lang = await languageIds(app.db);
  runner = await registerRunner(app.db);
});
afterAll(() => app?.close());

/** Leases and completes every queued job so each test starts with an empty queue. */
async function drainRuns() {
  for (let i = 0; i < 50; i++) {
    const job = await lease(app, runner);
    if (!job) return;
    await postResult(app, runner, signResult(resultFor(job, runner), runner.privateKey));
  }
}
beforeEach(drainRuns);

const submit = (u: TestUser, stageRunId: string, payload: object, headers: Record<string, string> = {}) =>
  app.call(u, { method: 'POST', url: `/v1/stage-runs/${stageRunId}/submissions`, payload, headers });
const py = (source = 'print(input())\n') => ({ languageId: lang.python!, source, explanation: 'echo the line' });

describe('submissions', () => {
  it('stores source and explanation, and lists history oldest first', async () => {
    const u = await app.user();
    const { stageRunId } = await startCodingSession(app, u, modeId);
    const a = await submit(u, stageRunId, py('print(1)\n'));
    const b = await submit(u, stageRunId, py('print(2)\n'));
    expect(a.statusCode).toBe(201);
    expect(a.json).toMatchObject({ stageRunId, languageId: lang.python, source: 'print(1)\n', explanation: 'echo the line' });
    const list = await app.call(u, { method: 'GET', url: `/v1/stage-runs/${stageRunId}/submissions` });
    expect(list.statusCode).toBe(200);
    expect(list.json.items.map((s: { id: string }) => s.id)).toEqual([a.json.id, b.json.id]);
  });

  it('is idempotent on Idempotency-Key and rejects key reuse with a different body', async () => {
    const u = await app.user();
    const { stageRunId } = await startCodingSession(app, u, modeId);
    const key = { 'idempotency-key': 'sub-1' };
    const first = await submit(u, stageRunId, py(), key);
    const retry = await submit(u, stageRunId, py(), key);
    expect(retry.statusCode).toBe(201);
    expect(retry.json.id).toBe(first.json.id);
    const [{ n }] = (await app.db.query<{ n: number }>('select count(*)::int as n from code_submissions where stage_run_id = $1', [stageRunId])) as [{ n: number }];
    expect(n).toBe(1);
    const other = await submit(u, stageRunId, py('print(3)\n'), key);
    expect(other.statusCode).toBe(409);
  });

  it('enforces the 64 KB source cap in bytes, and validates the language', async () => {
    const u = await app.user();
    const { stageRunId } = await startCodingSession(app, u, modeId);
    // 'é' is 2 bytes: under the char count, over the byte cap.
    const big = await submit(u, stageRunId, py('é'.repeat(MAX_SOURCE_BYTES / 2 + 1)));
    expect(big.statusCode).toBe(400);
    const exact = await submit(u, stageRunId, py('x'.repeat(MAX_SOURCE_BYTES)));
    expect(exact.statusCode).toBe(201);
    const unknown = await submit(u, stageRunId, { ...py(), languageId: '00000000-0000-4000-8000-000000000000' });
    expect(unknown.statusCode).toBe(400);
    // The problem allows python only.
    const js = await submit(u, stageRunId, { ...py(), languageId: lang.javascript! });
    expect(js.statusCode).toBe(400);
    expect(js.json.errors[0].path).toBe('body.languageId');
    await app.db.query(`update languages set enabled = false where slug = 'python'`, []);
    try {
      expect((await submit(u, stageRunId, py())).statusCode).toBe(400);
    } finally {
      await app.db.query(`update languages set enabled = true where slug = 'python'`, []);
    }
  });

  it('history, results and runs are owner-only (404 for another user)', async () => {
    const owner = await app.user();
    const other = await app.user();
    const { stageRunId } = await startCodingSession(app, owner, modeId);
    const sub = await submit(owner, stageRunId, py());
    expect((await app.call(other, { method: 'GET', url: `/v1/stage-runs/${stageRunId}/submissions` })).statusCode).toBe(404);
    expect((await app.call(other, { method: 'GET', url: `/v1/submissions/${sub.json.id}/result` })).statusCode).toBe(404);
    expect((await app.call(other, { method: 'POST', url: `/v1/submissions/${sub.json.id}/run` })).statusCode).toBe(404);
    expect((await submit(other, stageRunId, py())).statusCode).toBe(404);
  });
});

describe('server-authoritative deadline', () => {
  it('accepts inside timeLimitSec plus grace and rejects after it with invalid_state', async () => {
    const u = await app.user();
    const { sessionId, stageRunId } = await startCodingSession(app, u, modeId);
    const state = await app.call(u, { method: 'GET', url: `/v1/sessions/${sessionId}/state` });
    expect(state.json.remainingSec).toBeGreaterThan(0);
    expect(state.json.remainingSec).toBeLessThanOrEqual(60);
    expect(state.json.currentStage.deadlineAt).toBeTruthy();

    await setDeadline(app.db, stageRunId, -10); // 10s past the deadline, inside the 30s grace
    const late = await submit(u, stageRunId, py());
    expect(late.statusCode).toBe(201);
    const remaining = await app.call(u, { method: 'GET', url: `/v1/sessions/${sessionId}/state` });
    expect(remaining.json.remainingSec).toBe(0);

    await setDeadline(app.db, stageRunId, -31); // past deadline plus grace
    const tooLate = await submit(u, stageRunId, py());
    expect(tooLate.statusCode).toBe(409);
    expect(tooLate.json.code).toBe('invalid_state');
    const run = await app.call(u, { method: 'POST', url: `/v1/submissions/${late.json.id}/run` });
    expect(run.statusCode).toBe(409);
    expect(run.json.code).toBe('invalid_state');
  });
});

describe('practice runs', () => {
  it('allows one active run per user; a retry returns the same job', async () => {
    const u = await app.user();
    const { stageRunId } = await startCodingSession(app, u, modeId);
    const a = await submit(u, stageRunId, py('print(1)\n'));
    const b = await submit(u, stageRunId, py('print(2)\n'));
    const run1 = await app.call(u, { method: 'POST', url: `/v1/submissions/${a.json.id}/run` });
    expect(run1.statusCode).toBe(202);
    expect(run1.json).toMatchObject({ submissionId: a.json.id, suite: 'visible', status: 'queued' });
    const retry = await app.call(u, { method: 'POST', url: `/v1/submissions/${a.json.id}/run` });
    expect(retry.statusCode).toBe(202);
    expect(retry.json.jobId).toBe(run1.json.jobId);
    const blocked = await app.call(u, { method: 'POST', url: `/v1/submissions/${b.json.id}/run` });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeTruthy();

    // The database backs the cap even if two requests race past the read.
    await expect(
      app.db.query(`insert into run_jobs (submission_id, user_id, suite) values ($1, $2, 'visible')`, [b.json.id, u.id]),
    ).rejects.toThrow();

    // Another user is unaffected.
    const v = await app.user();
    const s2 = await startCodingSession(app, v, modeId);
    const vs = await submit(v, s2.stageRunId, py());
    expect((await app.call(v, { method: 'POST', url: `/v1/submissions/${vs.json.id}/run` })).statusCode).toBe(202);

    await drainRuns();
    expect((await app.call(u, { method: 'POST', url: `/v1/submissions/${b.json.id}/run` })).statusCode).toBe(202);
  });

  it('rate limits practice runs per user per minute', async () => {
    const u = await app.user();
    const { stageRunId } = await startCodingSession(app, u, modeId);
    const sub = await submit(u, stageRunId, py());
    let last = 0;
    for (let i = 0; i < 11; i++) {
      const r = await app.call(u, { method: 'POST', url: `/v1/submissions/${sub.json.id}/run` });
      last = r.statusCode;
      if (r.statusCode === 429) break;
      await drainRuns();
    }
    expect(last).toBe(429);
  });
});

describe('hidden tests are never disclosed', () => {
  it('appears in no candidate response and no log line, end to end through a graded run', async () => {
    const u = await app.user();
    const bodies: string[] = [];
    const { sessionId, stageRunId, bodies: first } = await startCodingSession(app, u, modeId);
    bodies.push(...first);
    const sub = await submit(u, stageRunId, py());
    bodies.push(sub.body);
    const run = await app.call(u, { method: 'POST', url: `/v1/submissions/${sub.json.id}/run` });
    bodies.push(run.body);

    // The visible run leases only sample tests, and the runner never sees test names.
    const visibleJob = (await lease(app, runner))!;
    expect(visibleJob.tests.map((t) => t.id)).toEqual(['v0']);
    expect(JSON.stringify(visibleJob)).not.toContain(SECRET.hiddenInput);
    expect(JSON.stringify(visibleJob)).not.toContain('sample');
    await postResult(app, runner, signResult(resultFor(visibleJob, runner), runner.privateKey));
    const visibleRes = await app.call(u, { method: 'GET', url: `/v1/submissions/${sub.json.id}/result` });
    bodies.push(visibleRes.body);
    expect(visibleRes.json.result.perTest).toEqual([{ name: 'sample', passed: true, timeMs: 12, memKb: 2048 }]);

    // Final answer: a code turn enqueues the graded run over visible + hidden tests.
    const state = await app.call(u, { method: 'GET', url: `/v1/sessions/${sessionId}/state` });
    bodies.push(state.body);
    const turn = await app.call(u, {
      method: 'POST', url: `/v1/sessions/${sessionId}/turns`,
      payload: { seq: state.json.nextSeq, content: { type: 'code', submissionId: sub.json.id } },
    });
    bodies.push(turn.body);
    const graded = (await lease(app, runner))!;
    expect(graded.suite).toBe('full');
    expect(graded.tests.map((t) => t.id)).toEqual(['v0', 'h0', 'h1']);
    expect(JSON.stringify(graded)).not.toContain(SECRET.hiddenName);
    await postResult(app, runner, signResult(resultFor(graded, runner, (id) => id !== 'h1'), runner.privateKey));

    const res = await app.call(u, { method: 'GET', url: `/v1/submissions/${sub.json.id}/result` });
    bodies.push(res.body);
    expect(res.json.result).toMatchObject({ status: 'failed', hiddenPassed: 1, hiddenTotal: 2 });
    expect(res.json.result.perTest).toHaveLength(1);
    for (const url of [`/v1/sessions/${sessionId}`, `/v1/sessions/${sessionId}/state`, `/v1/stage-runs/${stageRunId}/submissions`]) {
      bodies.push((await app.call(u, { method: 'GET', url })).body);
    }

    const everything = [...bodies, ...app.logs].join('\n');
    for (const secret of [SECRET.hiddenName, SECRET.hiddenInput, SECRET.hiddenExpected]) {
      expect(everything).not.toContain(secret);
    }
    // Sanity: the check can see real content (the visible sample is shown to the candidate).
    expect(bodies.join('\n')).toContain(SECRET.visibleExpected);
  });
});
