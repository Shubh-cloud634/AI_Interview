import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestApp, seeded, type TestApp, type TestUser } from './helpers/app';
import { answer, completedWithReport, getState, startSession } from './helpers/flows';

/**
 * User B must not read or modify anything of user A's. Every attempt is 404 (not 403), and A's rows
 * are unchanged afterwards.
 */
let t: TestApp;
let a: TestUser;
let b: TestUser;
const ids = { resume: '', session: '', reportSession: '', stageRun: '', submission: '' };

beforeAll(async () => {
  t = await createTestApp();
  const { mode } = await seeded(t.db);
  [a, b] = [await t.user(), await t.user()];

  const resume = await t.call(a, { method: 'POST', url: '/v1/resumes', payload: { fileName: 'cv.txt', contentType: 'text/plain', sizeBytes: 100 } });
  expect(resume.statusCode, resume.body).toBe(201);
  ids.resume = resume.json.resumeId;

  const profile = await t.call(a, { method: 'PATCH', url: '/v1/profile', payload: { headline: 'A headline' } });
  expect(profile.statusCode, profile.body).toBe(200);

  // Engineering screen: intro (2 answers) then the coding stage, where A makes a submission.
  const s = await startSession(t, a, mode('swe-screen'));
  ids.session = s.id;
  await answer(t, a, s.id);
  await answer(t, a, s.id);
  const state = await getState(t, a, s.id);
  expect(state.currentStage?.kind).toBe('coding');
  ids.stageRun = state.currentStage!.id;
  const [lang] = await t.db.query<{ id: string }>(`select id from languages where slug = 'python'`, []);
  const sub = await t.call(a, { method: 'POST', url: `/v1/stage-runs/${ids.stageRun}/submissions`, payload: { languageId: lang!.id, source: 'print(1)' } });
  expect(sub.statusCode, sub.body).toBe(201);
  ids.submission = sub.json.id;

  ids.reportSession = (await completedWithReport(t, a, mode('case-interview'))).session.id;
});
afterAll(() => t.close());

describe('cross-user isolation', () => {
  const attempts: [string, string, () => string, object?][] = [
    ['GET', 'resume', () => `/v1/resumes/${ids.resume}`],
    ['POST', 'resume complete', () => `/v1/resumes/${ids.resume}/complete`],
    ['GET', 'session', () => `/v1/sessions/${ids.session}`],
    ['GET', 'session state', () => `/v1/sessions/${ids.session}/state`],
    ['POST', 'session turn', () => `/v1/sessions/${ids.session}/turns`, { seq: 5, content: { type: 'text', text: 'hijack' } }],
    ['GET', 'session events', () => `/v1/sessions/${ids.session}/events`],
    ['POST', 'session end', () => `/v1/sessions/${ids.session}/end`],
    ['GET', 'evaluation', () => `/v1/sessions/${ids.reportSession}/evaluation`],
    ['GET', 'report', () => `/v1/sessions/${ids.reportSession}/report`],
    ['GET', 'stage run submissions', () => `/v1/stage-runs/${ids.stageRun}/submissions`],
    ['POST', 'create submission', () => `/v1/stage-runs/${ids.stageRun}/submissions`, { languageId: '00000000-0000-4000-8000-000000000000', source: 'x' }],
    ['POST', 'run submission', () => `/v1/submissions/${ids.submission}/run`],
    ['GET', 'submission result', () => `/v1/submissions/${ids.submission}/result`],
  ];

  test.each(attempts)('%s %s of another user is 404', async (method, _what, url, payload) => {
    const res = await t.call(b, { method: method as 'GET', url: url(), payload });
    expect(res.statusCode, res.body).toBe(404);
    expect(res.json.code).toBe('not_found');
  });

  test("B's profile endpoints only ever touch B's own profile", async () => {
    expect((await t.call(b, { method: 'GET', url: '/v1/profile' })).statusCode).toBe(404);
    const patched = await t.call(b, { method: 'PATCH', url: '/v1/profile', payload: { headline: 'B was here' } });
    expect(patched.statusCode).toBe(200);
    const mine = await t.call(a, { method: 'GET', url: '/v1/profile' });
    expect(mine.json.headline).toBe('A headline');
  });

  test("A's data is unchanged after B's attempts", async () => {
    const s = await t.call(a, { method: 'GET', url: `/v1/sessions/${ids.session}` });
    expect(s.json.status).toBe('awaiting_answer');
    const [turns] = await t.db.query<{ n: number }>('select count(*)::int as n from turns where session_id = $1', [ids.session]);
    expect(turns!.n).toBe(5); // q, a, follow-up, a, coding question
    const [r] = await t.db.query<{ status: string }>('select status from resumes where id = $1', [ids.resume]);
    expect(r!.status).toBe('awaiting_upload');
    const [subs] = await t.db.query<{ n: number }>('select count(*)::int as n from code_submissions where stage_run_id = $1', [ids.stageRun]);
    expect(subs!.n).toBe(1);
    const [runs] = await t.db.query<{ n: number }>(`select count(*)::int as n from run_jobs where submission_id = $1`, [ids.submission]);
    expect(runs!.n).toBe(0);
  });

  test('history, readiness, recommendations and analytics are per user', async () => {
    const hist = await t.call(b, { method: 'GET', url: '/v1/history' });
    expect(hist.statusCode).toBe(200);
    expect(hist.json.items).toEqual([]);
    expect((await t.call(a, { method: 'GET', url: '/v1/history' })).json.items).toHaveLength(1);
    expect((await t.call(b, { method: 'GET', url: '/v1/readiness' })).json.items).toEqual([]);
    expect((await t.call(b, { method: 'GET', url: '/v1/analytics/me' })).json.sessionsStarted).toBe(0);
    expect((await t.call(b, { method: 'GET', url: '/v1/recommendations' })).json.roles).toEqual([]);
  });

  test('RLS is a second wall: as app_user, B sees none of A\'s rows even with a raw query', async () => {
    const tables = ['resumes', 'profiles', 'sessions', 'stage_runs', 'turns', 'code_submissions', 'evaluations', 'reports', 'session_summaries', 'events', 'readiness'];
    for (const table of tables) {
      const rows = await t.db.asUser(b.id, (sql) => sql.query(`select 1 from ${table} where user_id = $1`, [a.id]));
      expect(rows, table).toEqual([]);
    }
    const updated = await t.db.asUser(b.id, (sql) => sql.query(`update sessions set status = 'abandoned' where id = $1 returning id`, [ids.session]));
    expect(updated).toEqual([]);
  });

  test('DELETE /v1/me removes only the caller', async () => {
    const c = await t.user();
    await t.call(c, { method: 'PATCH', url: '/v1/profile', payload: { headline: 'C' } });
    expect((await t.call(c, { method: 'DELETE', url: '/v1/me' })).statusCode).toBe(204);
    expect(await t.db.query('select 1 from users where id = $1', [c.id])).toEqual([]);
    expect(await t.db.query('select 1 from users where id = $1', [a.id])).toHaveLength(1);
  });
});
