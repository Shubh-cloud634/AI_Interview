import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestApp, seeded, type TestApp, type TestUser } from './helpers/app';
import { getState, startSession } from './helpers/flows';

let t: TestApp;
let u: TestUser;
let modeId: string;
beforeAll(async () => {
  t = await createTestApp();
  modeId = (await seeded(t.db)).mode('case-interview');
  u = await t.user();
});
afterAll(() => t.close());

describe('validation errors are problem+json', () => {
  const cases: [string, object][] = [
    ['bad body field', { method: 'POST', url: '/v1/sessions', payload: { modeId: 'not-a-uuid' } }],
    ['missing body', { method: 'POST', url: '/v1/sessions' }],
    ['bad path param', { method: 'GET', url: '/v1/sessions/123' }],
    ['bad query', { method: 'GET', url: '/v1/history?limit=-5' }],
    ['empty patch', { method: 'PATCH', url: '/v1/profile', payload: {} }],
    ['wrong content type for resume', { method: 'POST', url: '/v1/resumes', payload: { fileName: 'x.exe', contentType: 'application/x-msdownload', sizeBytes: 10 } }],
  ];
  test.each(cases)('%s', async (_name, req) => {
    const res = await t.call(u, req as never);
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.json).toMatchObject({ status: 400, code: 'validation_failed', type: expect.stringContaining('validation_failed') });
  });

  test('field errors carry paths', async () => {
    const res = await t.call(u, { method: 'POST', url: '/v1/sessions', payload: { modeId: 'nope' } });
    expect(res.json.errors).toEqual([expect.objectContaining({ path: 'body.modeId' })]);
  });

  test('malformed JSON is a 400 problem, not a 500', async () => {
    const res = await t.call(u, { method: 'POST', url: '/v1/sessions', payload: '{"modeId":', headers: { 'content-type': 'application/json' } });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.json.code).toBe('validation_failed');
  });

  test('unsupported media type is a problem', async () => {
    const res = await t.call(u, { method: 'POST', url: '/v1/sessions', payload: 'modeId=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(res.statusCode).toBe(415);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
  });

  test('a body over the limit is 413 payload_too_large', async () => {
    const res = await t.call(u, { method: 'POST', url: '/v1/sessions', payload: JSON.stringify({ modeId, pad: 'x'.repeat(300 * 1024) }), headers: { 'content-type': 'application/json' } });
    expect(res.statusCode).toBe(413);
    expect(res.json.code).toBe('payload_too_large');
  });

  test('a 500 never leaks internals', async () => {
    t.db.failNext(/from mode_versions/);
    const res = await t.call(u, { method: 'GET', url: `/v1/modes/${modeId}` });
    expect(res.statusCode).toBe(500);
    expect(res.json).toMatchObject({ code: 'internal', title: 'Internal error' });
    expect(res.body).not.toContain('injected');
  });
});

describe('idempotent creates', () => {
  test('same key and body replays the stored response without a second create', async () => {
    const headers = { 'idempotency-key': 'create-1' };
    const first = await t.call(u, { method: 'POST', url: '/v1/sessions', payload: { modeId }, headers });
    const again = await t.call(u, { method: 'POST', url: '/v1/sessions', payload: { modeId }, headers });
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(201);
    expect(again.json.id).toBe(first.json.id);
    const rows = await t.db.query<{ n: number }>('select count(*)::int as n from sessions where user_id = $1', [u.id]);
    expect(rows[0]!.n).toBe(1);
    expect(t.ai.callsOf('generateQuestion')).toHaveLength(1);
  });

  test('same key with a different body is 409 conflict', async () => {
    const headers = { 'idempotency-key': 'resume-1' };
    const body = { fileName: 'cv.txt', contentType: 'text/plain', sizeBytes: 100 };
    expect((await t.call(u, { method: 'POST', url: '/v1/resumes', payload: body, headers })).statusCode).toBe(201);
    const other = await t.call(u, { method: 'POST', url: '/v1/resumes', payload: { ...body, sizeBytes: 101 }, headers });
    expect(other.statusCode).toBe(409);
    expect(other.json.code).toBe('conflict');
  });

  test('keys are scoped per user', async () => {
    const other = await t.user();
    const headers = { 'idempotency-key': 'resume-1' };
    const res = await t.call(other, { method: 'POST', url: '/v1/resumes', payload: { fileName: 'b.txt', contentType: 'text/plain', sizeBytes: 5 }, headers });
    expect(res.statusCode).toBe(201);
  });

  test('a failed create releases the key so the retry runs', async () => {
    const headers = { 'idempotency-key': 'flaky-create' };
    t.db.failNext(/insert into sessions/);
    expect((await t.call(u, { method: 'POST', url: '/v1/sessions', payload: { modeId }, headers })).statusCode).toBe(500);
    const retry = await t.call(u, { method: 'POST', url: '/v1/sessions', payload: { modeId }, headers });
    expect(retry.statusCode).toBe(201);
  });

  test('an oversized key is rejected', async () => {
    const res = await t.call(u, { method: 'POST', url: '/v1/resumes', payload: { fileName: 'c.txt', contentType: 'text/plain', sizeBytes: 5 }, headers: { 'idempotency-key': 'k'.repeat(201) } });
    expect(res.statusCode).toBe(400);
  });
});

describe('turn idempotency by seq', () => {
  test('resending the same {seq, content} replays; nothing is appended twice', async () => {
    const s = await startSession(t, u, modeId);
    const { nextSeq } = await getState(t, u, s.id);
    const payload = { seq: nextSeq, content: { type: 'text', text: 'My answer' } };
    const first = await t.call(u, { method: 'POST', url: `/v1/sessions/${s.id}/turns`, payload });
    const again = await t.call(u, { method: 'POST', url: `/v1/sessions/${s.id}/turns`, payload });
    expect(first.statusCode).toBe(200);
    expect(first.json.replayed).toBe(false);
    expect(again.statusCode).toBe(200);
    expect(again.json.replayed).toBe(true);
    expect(again.json.interviewerTurn).toEqual(first.json.interviewerTurn);
    const [n] = await t.db.query<{ n: number }>(`select count(*)::int as n from turns where session_id = $1 and actor = 'candidate'`, [s.id]);
    expect(n!.n).toBe(1);
  });

  test('same seq with different content is seq_conflict with expectedSeq', async () => {
    const s = await startSession(t, u, modeId);
    const { nextSeq } = await getState(t, u, s.id);
    await t.call(u, { method: 'POST', url: `/v1/sessions/${s.id}/turns`, payload: { seq: nextSeq, content: { type: 'text', text: 'one' } } });
    const res = await t.call(u, { method: 'POST', url: `/v1/sessions/${s.id}/turns`, payload: { seq: nextSeq, content: { type: 'text', text: 'two' } } });
    expect(res.statusCode).toBe(409);
    expect(res.json.code).toBe('seq_conflict');
    expect(res.json.expectedSeq).toBe((await getState(t, u, s.id)).nextSeq);
  });

  test.each([['skipped ahead', 5], ['stale', 1]])('a %s seq is seq_conflict with expectedSeq', async (_n, seq) => {
    const s = await startSession(t, u, modeId);
    const { nextSeq } = await getState(t, u, s.id);
    const res = await t.call(u, { method: 'POST', url: `/v1/sessions/${s.id}/turns`, payload: { seq, content: { type: 'text', text: 'x' } } });
    expect(res.statusCode).toBe(409);
    expect(res.json.code).toBe('seq_conflict');
    expect(res.json.expectedSeq).toBe(nextSeq);
  });

  test('an answer type the stage kind does not accept is 400', async () => {
    const s = await startSession(t, u, modeId); // first stage is conversation: text only
    const { nextSeq } = await getState(t, u, s.id);
    const res = await t.call(u, { method: 'POST', url: `/v1/sessions/${s.id}/turns`, payload: { seq: nextSeq, content: { type: 'structured', fields: { a: 'b' } } } });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toMatch(/problem\+json/);
  });
});
