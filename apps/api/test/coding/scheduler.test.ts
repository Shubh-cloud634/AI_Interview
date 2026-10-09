import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RUNNER_AUTH_SCHEME, RUNNER_ID_HEADER, type LeasedJob } from '@ai-interview/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import {
  createCodingMode,
  languageIds,
  lease,
  postResult,
  registerRunner,
  resultFor,
  runnerHeaders,
  signResult,
  startCodingSession,
  type TestRunner,
} from './fixture';

let app: TestApp;
let modeId: string;
let lang: Record<string, string>;
let runner: TestRunner;
let rogue: TestRunner;

beforeAll(async () => {
  app = await createTestApp();
  modeId = await createCodingMode(app.db);
  lang = await languageIds(app.db);
  runner = await registerRunner(app.db);
  rogue = await registerRunner(app.db);
});
afterAll(() => app?.close());

beforeEach(async () => {
  // Isolate tests: nothing left queued or leased from a previous one.
  await app.db.query(`update run_jobs set status = 'failed', failure_reason = 'queue_ttl' where status in ('queued', 'leased')`, []);
});

/** A fresh candidate with one queued practice run, leased by `by`. */
async function leasedJob(by: TestRunner = runner): Promise<{ job: LeasedJob; submissionId: string }> {
  const u = await app.user();
  const { stageRunId } = await startCodingSession(app, u, modeId);
  const sub = await app.call(u, { method: 'POST', url: `/v1/stage-runs/${stageRunId}/submissions`, payload: { languageId: lang.python, source: 'print(1)\n' } });
  const run = await app.call(u, { method: 'POST', url: `/v1/submissions/${sub.json.id}/run` });
  expect(run.statusCode).toBe(202);
  const job = await lease(app, by);
  expect(job?.jobId).toBe(run.json.jobId);
  return { job: job!, submissionId: sub.json.id };
}

const jobRow = async (id: string) =>
  (await app.db.query<{ status: string; failure_reason: string | null; attempts: number }>('select status, failure_reason, attempts from run_jobs where id = $1', [id]))[0]!;

describe('runner authentication', () => {
  const leaseWith = (headers: Record<string, string>) => app.internal.inject({ method: 'POST', url: '/internal/scheduler/lease', headers });

  it('rejects a missing or wrong credential, a bad signature, a stale timestamp and a revoked runner', async () => {
    expect((await leaseWith({})).statusCode).toBe(401);
    expect((await leaseWith({ ...runnerHeaders(runner, 'lease'), authorization: `${RUNNER_AUTH_SCHEME} wrong` })).statusCode).toBe(401);
    // Valid credential, but signed by another runner's key.
    const forged = { ...runnerHeaders(rogue, 'lease'), authorization: `${RUNNER_AUTH_SCHEME} ${runner.credential}`, [RUNNER_ID_HEADER]: runner.id };
    expect((await leaseWith(forged)).statusCode).toBe(401);
    expect((await leaseWith(runnerHeaders(runner, 'lease', [], Date.now() - 5 * 60_000))).statusCode).toBe(401);
    // A heartbeat signature is not a lease signature.
    expect((await leaseWith(runnerHeaders(runner, 'heartbeat'))).statusCode).toBe(401);
    expect((await leaseWith(runnerHeaders(runner, 'lease'))).statusCode).toBe(200);

    const revoked = await registerRunner(app.db);
    await app.db.query('update sandbox_runners set revoked_at = now() where id = $1', [revoked.id]);
    expect((await leaseWith(runnerHeaders(revoked, 'lease'))).statusCode).toBe(401);
  });

  it('rejects a replayed signed request', async () => {
    const headers = runnerHeaders(runner, 'lease');
    expect((await leaseWith(headers)).statusCode).toBe(200);
    expect((await leaseWith(headers)).statusCode).toBe(401);
  });

  it('candidate tokens cannot reach the scheduler and the public app has no scheduler route', async () => {
    const u = await app.user();
    expect((await app.call(u, { method: 'POST', url: '/internal/scheduler/lease' })).statusCode).toBe(404);
    expect((await leaseWith(u.headers)).statusCode).toBe(401);
  });
});

describe('result acceptance', () => {
  it('accepts a correctly signed result once; a replay is rejected', async () => {
    const { job, submissionId } = await leasedJob();
    const signed = signResult(resultFor(job, runner), runner.privateKey);
    expect((await postResult(app, runner, signed)).statusCode).toBe(204);
    expect((await postResult(app, runner, signed)).statusCode).toBe(409);
    expect((await jobRow(job.jobId)).status).toBe('completed');
    const [{ n }] = (await app.db.query<{ n: number }>('select count(*)::int as n from run_results where job_id = $1', [job.jobId])) as [{ n: number }];
    expect(n).toBe(1);
    expect(submissionId).toBeTruthy();
  });

  it('rejects forgery: tampered fields, a signature from another key, or another runner posting', async () => {
    const { job } = await leasedJob();
    const good = signResult(resultFor(job, runner), runner.privateKey);
    // Flip the outcome after signing.
    const tampered = { ...good, result: { ...good.result, perTest: good.result.perTest.map((t) => ({ ...t, timeMs: 1 })) } };
    expect((await postResult(app, runner, tampered)).statusCode).toBe(401);
    // Signed with the rogue key but claiming to be the leasing runner.
    expect((await postResult(app, runner, signResult(resultFor(job, runner), rogue.privateKey))).statusCode).toBe(401);
    // The rogue runner, with its own valid key and credential, posting for a lease it does not hold.
    expect((await postResult(app, rogue, signResult(resultFor(job, rogue), rogue.privateKey))).statusCode).toBe(409);
    // Credential of one runner with a result claiming another.
    expect((await postResult(app, rogue, good)).statusCode).toBe(401);
    expect((await jobRow(job.jobId)).status).toBe('leased');
    expect((await postResult(app, runner, good)).statusCode).toBe(204);
  });

  it('rejects a wrong lease, a wrong nonce, a different source hash and an expired lease', async () => {
    const { job } = await leasedJob();
    const variants = [{ leaseId: randomUUID() }, { nonce: 'f'.repeat(32) }, { sourceSha256: 'a'.repeat(64) }];
    for (const v of variants) {
      const res = await postResult(app, runner, signResult({ ...resultFor(job, runner), ...v }, runner.privateKey));
      expect(res.statusCode, JSON.stringify(v)).toBe(409);
    }
    await app.db.query(`update run_jobs set lease_expires_at = now() - interval '1 second' where id = $1`, [job.jobId]);
    expect((await postResult(app, runner, signResult(resultFor(job, runner), runner.privateKey))).statusCode).toBe(409);
  });

  it('a stale lease cannot complete a job after it was re-leased', async () => {
    const { job: first } = await leasedJob();
    await app.db.query(`update run_jobs set lease_expires_at = now() - interval '1 second' where id = $1`, [first.jobId]);
    const second = (await lease(app, rogue))!;
    expect(second.jobId).toBe(first.jobId);
    expect(second.leaseId).not.toBe(first.leaseId);
    await app.db.query(`update run_jobs set lease_expires_at = now() + interval '1 minute' where id = $1`, [first.jobId]);
    expect((await postResult(app, runner, signResult(resultFor(first, runner), runner.privateKey))).statusCode).toBe(409);
    expect((await postResult(app, rogue, signResult(resultFor(second, rogue), rogue.privateKey))).statusCode).toBe(204);
  });

  it('rejects internally inconsistent results and results that skip leased tests', async () => {
    const { job } = await leasedJob();
    const lying = { ...resultFor(job, runner, () => false), status: 'passed' as const };
    expect((await postResult(app, runner, signResult(lying, runner.privateKey))).statusCode).toBe(400);
    const partial = { ...resultFor(job, runner), perTest: [] };
    expect((await postResult(app, runner, signResult(partial, runner.privateKey))).statusCode).toBe(400);
  });

  it('stores sandbox output sanitized', async () => {
    const { job, submissionId } = await leasedJob();
    const stdout = '\u001b[31mred\u001b[0m /home/runner/secret/path.txt ‮evil\u0007';
    expect((await postResult(app, runner, signResult({ ...resultFor(job, runner), stdout }, runner.privateKey))).statusCode).toBe(204);
    const [row] = await app.db.query<{ user_id: string }>('select user_id from run_jobs where id = $1', [job.jobId]);
    const res = await app.call(await app.user(row!.user_id), { method: 'GET', url: `/v1/submissions/${submissionId}/result` });
    expect(res.json.result.stdout).toBe('red <path> evil');
  });
});

describe('leases, heartbeats and dead letters', () => {
  const beat = (r: TestRunner, jobId: string, leaseId: string) =>
    app.internal.inject({
      method: 'POST', url: '/internal/scheduler/heartbeat',
      headers: runnerHeaders(r, 'heartbeat', [jobId, leaseId]), payload: { jobId, leaseId },
    });

  it('a heartbeat extends only the live lease of the runner holding it', async () => {
    const { job } = await leasedJob();
    const ok = await beat(runner, job.jobId, job.leaseId);
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body).cancel).toBe(false);
    expect(JSON.parse((await beat(runner, job.jobId, randomUUID())).body).cancel).toBe(true);
    expect(JSON.parse((await beat(rogue, job.jobId, job.leaseId)).body).cancel).toBe(true);
    // Signature bound to the fields: a signature for one job does not authorize another.
    const res = await app.internal.inject({
      method: 'POST', url: '/internal/scheduler/heartbeat',
      headers: runnerHeaders(runner, 'heartbeat', [job.jobId, job.leaseId]), payload: { jobId: randomUUID(), leaseId: job.leaseId },
    });
    expect(res.statusCode).toBe(401);
    // Heartbeats cannot hold a lease past the cap.
    await app.db.query(`update run_jobs set leased_at = now() - interval '11 minutes' where id = $1`, [job.jobId]);
    expect(JSON.parse((await beat(runner, job.jobId, job.leaseId)).body).cancel).toBe(true);
  });

  it('runner internal errors are retried, then dead-lettered after max attempts', async () => {
    const { job } = await leasedJob();
    let current = job;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await postResult(app, runner, signResult({ ...resultFor(current, runner, () => false), status: 'internal_error', perTest: current.tests.map((t) => ({ id: t.id, status: 'internal_error' as const, passed: false, timeMs: 0, memKb: 0 })) }, runner.privateKey));
      expect(res.statusCode).toBe(204);
      const row = await jobRow(job.jobId);
      if (attempt < 3) {
        expect(row.status).toBe('queued');
        current = (await lease(app, runner))!;
        expect(current.jobId).toBe(job.jobId);
      } else {
        expect(row).toMatchObject({ status: 'failed', failure_reason: 'runner_internal_error', attempts: 3 });
      }
    }
  });

  it('a lost lease is reclaimed, and dead-lettered once attempts run out', async () => {
    const { job } = await leasedJob();
    await app.db.query(`update run_jobs set lease_expires_at = now() - interval '1 second', attempts = max_attempts where id = $1`, [job.jobId]);
    expect(await lease(app, runner)).toBeNull();
    expect(await jobRow(job.jobId)).toMatchObject({ status: 'failed', failure_reason: 'max_attempts' });
  });

  it('queued jobs past their TTL are dead-lettered', async () => {
    const { job } = await leasedJob();
    await app.db.query(`update run_jobs set status = 'queued', lease_id = null, created_at = now() - interval '1 hour' where id = $1`, [job.jobId]);
    expect(await lease(app, runner)).toBeNull();
    expect(await jobRow(job.jobId)).toMatchObject({ status: 'failed', failure_reason: 'queue_ttl' });
  });
});
