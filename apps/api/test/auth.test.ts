import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { HTTPMethods } from 'fastify';
import { createTestApp, type TestApp } from './helpers/app';
import { mintToken, TEST_SUPABASE_URL } from './helpers/tokens';

const CONTRACT = join(dirname(fileURLToPath(import.meta.url)), '../../../packages/shared/CONTRACT.md');

/** Every endpoint row of the contract table: `| GET | /v1/me | ... |`. */
function contractRoutes(): { method: HTTPMethods; path: string }[] {
  return [...readFileSync(CONTRACT, 'utf8').matchAll(/^\|\s*(GET|POST|PATCH|PUT|DELETE)\s*\|\s*(\/\S+)\s*\|/gm)].map((m) => ({
    method: m[1] as HTTPMethods,
    path: m[2]!,
  }));
}

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

describe('authentication', () => {
  const routes = contractRoutes();

  test('the contract table was parsed', () => {
    expect(routes.length).toBeGreaterThan(30);
  });

  test('every contract route is registered', () => {
    const missing = routes.filter((r) => !t.app.hasRoute({ method: r.method, url: r.path.replace(/\{(\w+)\}/g, ':$1') }));
    expect(missing).toEqual([]);
  });

  test('GET /health needs no token', async () => {
    const res = await t.call(null, { method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json).toEqual({ ok: true });
  });

  test.each(contractRoutes().filter((r) => r.path !== '/health'))('$method $path rejects a missing token with 401 problem+json', async (r) => {
    const res = await t.call(null, { method: r.method as 'GET', url: r.path.replace(/\{\w+\}/g, randomUUID()), payload: r.method === 'GET' || r.method === 'DELETE' ? undefined : {} });
    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.json.code).toBe('unauthorized');
  });

  test('unknown routes also require auth (no route enumeration without a token)', async () => {
    const res = await t.call(null, { method: 'GET', url: '/v1/does-not-exist' });
    expect(res.statusCode).toBe(401);
  });

  const bad: [string, () => Promise<string>][] = [
    ['wrong secret', () => mintToken(randomUUID(), { secret: 'another-secret-another-secret-another-secret' })],
    ['wrong issuer', () => mintToken(randomUUID(), { issuer: 'https://evil.test/auth/v1' })],
    ['wrong audience', () => mintToken(randomUUID(), { audience: 'anon' })],
    ['expired', () => mintToken(randomUUID(), { expiresIn: '-1m' })],
    ['non-uuid subject', () => mintToken('not-a-uuid')],
    ['garbage', async () => 'abc.def.ghi'],
  ];
  test.each(bad)('rejects a token with %s', async (_name, make) => {
    const res = await t.call(null, { method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${await make()}` } });
    expect(res.statusCode).toBe(401);
    expect(res.json.code).toBe('unauthorized');
  });

  test('rejects an unsigned (alg none) token', async () => {
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const token = `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: randomUUID(), iss: `${TEST_SUPABASE_URL}/auth/v1`, aud: 'authenticated', exp: 9e9 })}.`;
    const res = await t.call(null, { method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(401);
  });

  test('rejects a non-Bearer scheme', async () => {
    const res = await t.call(null, { method: 'GET', url: '/v1/me', headers: { authorization: `Basic ${await mintToken()}` } });
    expect(res.statusCode).toBe(401);
  });

  test('a valid token works and creates the user row', async () => {
    const u = await t.user();
    const res = await t.call(u, { method: 'GET', url: '/v1/me' });
    expect(res.statusCode).toBe(200);
    expect(res.json).toMatchObject({ id: u.id, roles: ['candidate'] });
  });
});
