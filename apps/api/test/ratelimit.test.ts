import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestApp, seeded, type TestApp } from './helpers/app';

let t: TestApp;
let modeId: string;
beforeAll(async () => {
  t = await createTestApp({ env: { RATE_LIMIT_GLOBAL_PER_MIN: '5', RATE_LIMIT_AI_PER_MIN: '2', RATE_LIMIT_RUN_PER_MIN: '2' } });
  modeId = (await seeded(t.db)).mode('case-interview');
});
afterAll(() => t.close());

function expectLimited(res: Awaited<ReturnType<TestApp['call']>>) {
  expect(res.statusCode).toBe(429);
  expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
  expect(res.json.code).toBe('rate_limited');
  const retry = Number(res.headers['retry-after']);
  expect(Number.isInteger(retry) && retry > 0 && retry <= 60).toBe(true);
}

describe('rate limiting', () => {
  test('AI-backed routes have the stricter limit', async () => {
    const u = await t.user();
    for (let i = 0; i < 2; i++) expect((await t.call(u, { method: 'POST', url: '/v1/sessions', payload: { modeId } })).statusCode).toBe(201);
    expectLimited(await t.call(u, { method: 'POST', url: '/v1/sessions', payload: { modeId } }));
  });

  test('the global limit applies per user, not per IP', async () => {
    const [a, b] = [await t.user(), await t.user()];
    for (let i = 0; i < 5; i++) expect((await t.call(a, { method: 'GET', url: '/v1/me' })).statusCode).toBe(200);
    expectLimited(await t.call(a, { method: 'GET', url: '/v1/me' }));
    // Same IP (inject), different user: unaffected.
    expect((await t.call(b, { method: 'GET', url: '/v1/me' })).statusCode).toBe(200);
  });

  test('a spoofed X-Forwarded-For does not reset a user\'s budget', async () => {
    const u = await t.user();
    for (let i = 0; i < 5; i++) await t.call(u, { method: 'GET', url: '/v1/me', headers: { 'x-forwarded-for': `10.0.0.${i}` } });
    expectLimited(await t.call(u, { method: 'GET', url: '/v1/me', headers: { 'x-forwarded-for': '10.9.9.9' } }));
  });

  test('/health is never limited', async () => {
    for (let i = 0; i < 10; i++) expect((await t.call(null, { method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
});
