import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RUNNER_ID_HEADER, RUNNER_SIG_HEADER, RUNNER_TS_HEADER, canonicalResult, canonicalRunnerRequest } from '@ai-interview/shared';
import { SchedulerClient } from '../src/scheduler-client';

const runnerId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';
const leaseId = '33333333-3333-4333-8333-333333333333';

function setup(respond: (url: string) => Response) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  const fakeFetch = (async (url: URL, init: RequestInit) => {
    calls.push({ url: url.pathname, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return respond(url.pathname);
  }) as unknown as typeof fetch;
  const client = new SchedulerClient({
    baseUrl: 'http://scheduler:4001', runnerId, credential: 'cred',
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), fetch: fakeFetch,
  });
  return { client, calls, publicKey };
}

describe('SchedulerClient', () => {
  it('signs requests the API can verify, with strictly increasing timestamps', async () => {
    const { client, calls, publicKey } = setup(() => Response.json({ job: null }));
    await client.lease();
    await client.lease();
    const [a, b] = calls.map((c) => c.headers);
    expect(Number(b![RUNNER_TS_HEADER])).toBeGreaterThan(Number(a![RUNNER_TS_HEADER]));
    expect(a!.authorization).toBe('Runner cred');
    const msg = canonicalRunnerRequest('lease', runnerId, Number(a![RUNNER_TS_HEADER]));
    expect(verify(null, Buffer.from(msg), publicKey, Buffer.from(a![RUNNER_SIG_HEADER]!, 'base64'))).toBe(true);
    expect(a![RUNNER_ID_HEADER]).toBe(runnerId);
  });

  it('binds heartbeat signatures to the job and lease', async () => {
    const { client, calls, publicKey } = setup(() => Response.json({ leaseExpiresAt: null, cancel: true }));
    expect((await client.heartbeat(jobId, leaseId)).cancel).toBe(true);
    const h = calls[0]!.headers;
    const ts = Number(h[RUNNER_TS_HEADER]);
    const sig = Buffer.from(h[RUNNER_SIG_HEADER]!, 'base64');
    expect(verify(null, Buffer.from(canonicalRunnerRequest('heartbeat', runnerId, ts, [jobId, leaseId])), publicKey, sig)).toBe(true);
    expect(verify(null, Buffer.from(canonicalRunnerRequest('heartbeat', runnerId, ts, [leaseId, jobId])), publicKey, sig)).toBe(false);
  });

  it('signs results over the canonical form and drops a rejected lease', async () => {
    const { client, calls, publicKey } = setup(() => new Response(null, { status: 409 }));
    const result = { jobId, leaseId, runnerId, nonce: 'n', sourceSha256: 'abc', status: 'passed' as const, perTest: [], stdout: '', stderr: '' };
    expect(await client.submit(result)).toBe('rejected');
    const { signature } = calls[0]!.body;
    expect(verify(null, Buffer.from(canonicalResult(result)), publicKey, Buffer.from(signature, 'base64'))).toBe(true);
  });
});
