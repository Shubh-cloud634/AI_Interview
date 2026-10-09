import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadConfig } from '../src/config';
import { createTestApp, seeded, TEST_ENV, type TestApp, type TestUser } from './helpers/app';
import { answer, getState, runToCompletion, startSession } from './helpers/flows';

const ORIGIN = 'https://app.example.test';
const SECRETS = {
  ANTHROPIC_API_KEY: 'sk-ant-SENTINEL-AI-KEY-0001',
  SUPABASE_SERVICE_ROLE_KEY: 'SENTINEL-SERVICE-ROLE-KEY-0002',
};
const RESUME_TEXT = 'SENTINEL-RESUME Jane Doe, engineer at Acme Corp, Python since 2015.';
const ANSWER_TEXT = 'SENTINEL-ANSWER I would shard by user id.';
const SOURCE = 'print("SENTINEL-SOURCE")';

let t: TestApp;
let u: TestUser;
beforeAll(async () => {
  t = await createTestApp({ env: { ...SECRETS, CORS_ORIGINS: `${ORIGIN},http://localhost:3000`, LOG_LEVEL: 'trace' } });
  u = await t.user();
});
afterAll(() => t.close());

describe('CORS', () => {
  test('an allowed origin is reflected exactly; credentials are not allowed', async () => {
    const res = await t.call(u, { method: 'GET', url: '/v1/me', headers: { origin: ORIGIN } });
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  test.each(['https://evil.test', 'https://app.example.test.evil.test', 'null', 'http://app.example.test'])('origin %s is not allowed', async (origin) => {
    const res = await t.call(u, { method: 'GET', url: '/v1/me', headers: { origin } });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('preflight works without a token for an allowed origin', async () => {
    const res = await t.call(null, { method: 'OPTIONS', url: '/v1/sessions', headers: { origin: ORIGIN, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type,idempotency-key' } });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
  });
});

describe('secure headers', () => {
  const expectHeaders = (h: Record<string, unknown>) => {
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['content-security-policy']).toContain("default-src 'none'");
    expect(h['cache-control']).toBe('no-store');
    expect(h['x-powered-by']).toBeUndefined();
  };
  test('on success, 401 and 404', async () => {
    expectHeaders((await t.call(u, { method: 'GET', url: '/v1/me' })).headers);
    expectHeaders((await t.call(null, { method: 'GET', url: '/v1/me' })).headers);
    expectHeaders((await t.call(u, { method: 'GET', url: '/v1/nope' })).headers);
    expectHeaders((await t.call(null, { method: 'GET', url: '/health' })).headers);
  });

  test('HSTS only in production', async () => {
    expect((await t.call(null, { method: 'GET', url: '/health' })).headers['strict-transport-security']).toBeUndefined();
  });

  test('the SSE stream keeps CORS and security headers', async () => {
    const { mode } = await seeded(t.db);
    const s = await startSession(t, u, mode('system-design'));
    await runToCompletion(t, u, s.id);
    const res = await t.call(u, { method: 'GET', url: `/v1/sessions/${s.id}/events`, headers: { origin: ORIGIN } });
    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.body).toContain('event: done');
  });
});

describe('config fails fast', () => {
  const prod = { ...TEST_ENV, NODE_ENV: 'production', ...SECRETS, CORS_ORIGINS: ORIGIN };
  test('a complete production config loads', () => {
    expect(loadConfig(prod).CORS_ORIGINS).toEqual([ORIGIN]);
  });
  test.each([
    ['ANTHROPIC_API_KEY', { ANTHROPIC_API_KEY: undefined }],
    ['SUPABASE_SERVICE_ROLE_KEY', { SUPABASE_SERVICE_ROLE_KEY: undefined }],
    ['CORS_ORIGINS', { CORS_ORIGINS: undefined }],
    ['CORS_ORIGINS', { CORS_ORIGINS: '*' }],
    ['CORS_ORIGINS', { CORS_ORIGINS: `${ORIGIN},*` }],
    ['CORS_ORIGINS', { CORS_ORIGINS: 'http://app.example.test' }],
    ['CORS_ORIGINS', { CORS_ORIGINS: `${ORIGIN}/` }],
    ['DATABASE_URL', { DATABASE_URL: undefined }],
    ['SUPABASE_URL', { SUPABASE_URL: 'http://project.supabase.test' }],
    ['SUPABASE_JWT_SECRET', { SUPABASE_JWT_SECRET: 'short' }],
  ])('production refuses to start: %s', (key, over) => {
    expect(() => loadConfig({ ...prod, ...over })).toThrow(new RegExp(key));
  });
  test('a wildcard origin is refused in every environment', () => {
    expect(() => loadConfig({ ...TEST_ENV, CORS_ORIGINS: '*' })).toThrow(/CORS_ORIGINS/);
  });
  test('the error names variables, never their values', () => {
    try {
      loadConfig({ ...prod, SUPABASE_JWT_SECRET: 'short-secret-value', CORS_ORIGINS: 'https://x.test/path' });
      expect.unreachable();
    } catch (err) {
      expect(String(err)).not.toContain('short-secret-value');
      expect(String(err)).not.toContain(SECRETS.ANTHROPIC_API_KEY);
    }
  });
  test('development defaults to the local web origin', () => {
    expect(loadConfig({ ...TEST_ENV }).CORS_ORIGINS).toEqual(['http://localhost:3000']);
  });
});

describe('secrets and sensitive data', () => {
  let bodies = '';
  beforeAll(async () => {
    const { mode } = await seeded(t.db);
    t.ai.always('extractProfile', { headline: null, summary: null, experiences: [], education: [], skills: [{ name: 'Python', level: 3, span: 'Python since 2015' }] });
    const created = await t.call(u, { method: 'POST', url: '/v1/resumes', payload: { fileName: 'cv.txt', contentType: 'text/plain', sizeBytes: Buffer.byteLength(RESUME_TEXT) } });
    const [row] = await t.db.query<{ object_key: string }>('select object_key from resumes where id = $1', [created.json.resumeId]);
    t.store.put(row!.object_key, RESUME_TEXT);
    await t.call(u, { method: 'POST', url: `/v1/resumes/${created.json.resumeId}/complete` });
    await t.drain();

    const s = await startSession(t, u, mode('swe-screen'));
    await answer(t, u, s.id, ANSWER_TEXT);
    await answer(t, u, s.id, ANSWER_TEXT);
    const st = await getState(t, u, s.id);
    const [lang] = await t.db.query<{ id: string }>(`select id from languages where slug = 'python'`, []);
    await t.call(u, { method: 'POST', url: `/v1/stage-runs/${st.currentStage!.id}/submissions`, payload: { languageId: lang!.id, source: SOURCE } });
    // A 500 whose underlying error carries row data, as Postgres constraint errors do.
    t.db.failNext(/from mode_versions/);
    await t.call(u, { method: 'GET', url: `/v1/modes/${mode('swe-screen')}` });
    t.app.log.error({ err: Object.assign(new Error('violates check constraint'), { detail: `Failing row contains (${SOURCE})` }) }, 'db error');

    for (const url of ['/v1/me', '/v1/profile', '/v1/readiness', `/v1/sessions/${s.id}`, `/v1/sessions/${s.id}/state`, '/v1/recommendations', '/v1/analytics/me', '/health', '/v1/domains']) {
      bodies += (await t.call(u, { method: 'GET', url })).body;
    }
  });

  test('logs were captured', () => {
    expect(t.logs.join('')).toContain('incoming request');
  });

  test.each([
    ['resume text', RESUME_TEXT.slice(0, 20)],
    ['answers', 'SENTINEL-ANSWER'],
    ['source code', 'SENTINEL-SOURCE'],
    ['the AI key', SECRETS.ANTHROPIC_API_KEY],
    ['the service role key', SECRETS.SUPABASE_SERVICE_ROLE_KEY],
    ['the JWT secret', TEST_ENV.SUPABASE_JWT_SECRET],
  ])('%s never appears in logs', (_n, needle) => {
    expect(t.logs.join('\n')).not.toContain(needle);
  });

  test('the bearer token never appears in logs', () => {
    expect(t.logs.join('\n')).not.toContain(u.token);
  });

  test.each([
    ['the AI key', SECRETS.ANTHROPIC_API_KEY],
    ['the service role key', SECRETS.SUPABASE_SERVICE_ROLE_KEY],
    ['the JWT secret', TEST_ENV.SUPABASE_JWT_SECRET],
  ])('%s is never serialized into a response', (_n, needle) => {
    expect(bodies.length).toBeGreaterThan(100);
    expect(bodies).not.toContain(needle);
  });
});
