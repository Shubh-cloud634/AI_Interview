import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import {
  RUNNER_AUTH_SCHEME,
  RUNNER_ID_HEADER,
  RUNNER_SIG_HEADER,
  RUNNER_TS_HEADER,
  canonicalResult,
  canonicalRunnerRequest,
  type LeasedJob,
  type RunnerRequestPurpose,
  type RunnerResult,
} from '@ai-interview/shared';
import type { TestDb } from '../helpers/db';
import type { TestApp, TestUser } from '../helpers/app';

/** Strings that must never appear in any candidate-visible response or any log line. */
export const SECRET = {
  hiddenName: 'HIDDEN_NAME_7f3a',
  hiddenInput: 'HIDDEN_INPUT_c91e',
  hiddenExpected: 'HIDDEN_EXPECTED_52bd',
  visibleExpected: 'VISIBLE_EXPECTED_ok',
} as const;

export const STAGE_SECONDS = 60;

/**
 * A published single-stage coding mode whose only problem has sentinel hidden tests and accepts
 * python only. Built through the normal pack tables and publish_pack_version, like a pack author would.
 */
export async function createCodingMode(db: TestDb): Promise<string> {
  const body = {
    title: 'Echo',
    prompt: 'Print the input back.',
    languages: ['python'],
    starterCode: { python: 'print(input())\n' },
    tests: {
      visible: [{ name: 'sample', input: 'hello\n', expected: SECRET.visibleExpected }],
      hidden: [
        { name: SECRET.hiddenName, input: `${SECRET.hiddenInput}\n`, expected: SECRET.hiddenExpected, weight: 3 },
        { name: `${SECRET.hiddenName}_2`, input: `${SECRET.hiddenInput}_2\n`, expected: `${SECRET.hiddenExpected}_2` },
      ],
    },
  };
  const spec = {
    stages: [
      { id: 'code', kind: 'coding', questionSource: { type: 'bank', tags: ['sentinel'] }, rubricRef: 'sentinel-code.v1', timeLimitSec: STAGE_SECONDS, weight: 1 },
    ],
  };
  const [row] = await db.query<{ mode_id: string }>(
    `with d as (insert into domains (slug, name) values ('sentinel-' || substr(md5(random()::text), 1, 8), 'Sentinel') returning id),
     p as (insert into packs (domain_id, slug, name) select id, 'sentinel', 'Sentinel' from d returning id),
     pv as (insert into pack_versions (pack_id, version) select id, 1 from p returning id),
     c as (insert into competencies (pack_version_id, slug, name) select id, 'ps', 'Problem solving' from pv returning id),
     r as (insert into rubrics (pack_version_id, slug, version) select id, 'sentinel-code', 1 from pv returning id),
     rc as (insert into rubric_criteria (rubric_id, competency_id, name, weight, levels)
            select r.id, c.id, 'Correctness', 1, '[{"score":0,"descriptor":"wrong"},{"score":4,"descriptor":"right"}]' from r, c returning id),
     q as (insert into question_templates (pack_version_id, kind, tags, difficulty, body, rubric_id)
           select pv.id, 'coding', array['sentinel'], 2, $1::jsonb, r.id from pv, r returning id),
     m as (insert into modes (pack_id, slug, name) select id, 'sentinel-mode', 'Sentinel coding' from p returning id),
     mv as (insert into mode_versions (mode_id, pack_version_id, version, spec) select m.id, pv.id, 1, $2::jsonb from m, pv returning mode_id)
     select (select mode_id from mv) as mode_id, (select count(*) from rc) + (select count(*) from q) as n`,
    [JSON.stringify(body), JSON.stringify(spec)],
  );
  const [pv] = await db.query<{ id: string }>(
    `select mv.pack_version_id as id from mode_versions mv where mv.mode_id = $1`,
    [row!.mode_id],
  );
  await db.query('select publish_pack_version($1)', [pv!.id]);
  return row!.mode_id;
}

export async function languageIds(db: TestDb) {
  const rows = await db.query<{ id: string; slug: string }>('select id, slug from languages', []);
  return Object.fromEntries(rows.map((r) => [r.slug, r.id])) as Record<string, string>;
}

/** Starts a session on the sentinel mode; returns the coding stage run. */
export async function startCodingSession(app: TestApp, u: TestUser, modeId: string) {
  const s = await app.call(u, { method: 'POST', url: '/v1/sessions', payload: { modeId } });
  if (s.statusCode !== 201) throw new Error(`session create failed: ${s.statusCode} ${s.body}`);
  const state = await app.call(u, { method: 'GET', url: `/v1/sessions/${s.json.id}/state` });
  return { sessionId: s.json.id as string, stageRunId: state.json.currentStage.id as string, bodies: [s.body, state.body] };
}

/** Moves the stage start into the past so the deadline is `secondsFromNow` away (negative: already passed). */
export async function setDeadline(db: TestDb, stageRunId: string, secondsFromNow: number) {
  await db.query(`update stage_runs set started_at = now() - make_interval(secs => $2) where id = $1`, [stageRunId, STAGE_SECONDS - secondsFromNow]);
}

// ---------- a test runner identity ----------

export interface TestRunner {
  id: string;
  credential: string;
  privateKey: KeyObject;
}

export async function registerRunner(db: TestDb, name = `runner-${randomBytes(4).toString('hex')}`): Promise<TestRunner> {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const credential = randomBytes(32).toString('base64url');
  const [r] = await db.query<{ id: string }>(
    'insert into sandbox_runners (name, public_key, credential_sha256) values ($1, $2, $3) returning id',
    [name, publicKey.export({ type: 'spki', format: 'pem' }).toString(), createHash('sha256').update(credential).digest('hex')],
  );
  return { id: r!.id, credential, privateKey };
}

let lastTs = 0;
/** Strictly increasing per process, as the real runner does. */
export const nextTs = () => (lastTs = Math.max(Date.now(), lastTs + 1));

export function runnerHeaders(r: TestRunner, purpose: RunnerRequestPurpose, fields: string[] = [], ts = nextTs()) {
  const sig = sign(null, Buffer.from(canonicalRunnerRequest(purpose, r.id, ts, fields)), r.privateKey).toString('base64');
  return {
    authorization: `${RUNNER_AUTH_SCHEME} ${r.credential}`,
    [RUNNER_ID_HEADER]: r.id,
    [RUNNER_TS_HEADER]: String(ts),
    [RUNNER_SIG_HEADER]: sig,
  };
}

export async function lease(app: TestApp, r: TestRunner): Promise<LeasedJob | null> {
  const res = await app.internal.inject({ method: 'POST', url: '/internal/scheduler/lease', headers: runnerHeaders(r, 'lease') });
  if (res.statusCode !== 200) throw new Error(`lease failed: ${res.statusCode} ${res.body}`);
  return JSON.parse(res.body).job;
}

/** A result where each test passes iff `passes(test)`; overall status follows. */
export function resultFor(job: LeasedJob, r: TestRunner, passes: (id: string) => boolean = () => true, extra: Partial<RunnerResult> = {}): RunnerResult {
  const perTest = job.tests.map((t) => ({ id: t.id, status: passes(t.id) ? ('passed' as const) : ('failed' as const), passed: passes(t.id), timeMs: 12, memKb: 2048 }));
  return {
    jobId: job.jobId, leaseId: job.leaseId, runnerId: r.id, nonce: job.nonce, sourceSha256: job.sourceSha256,
    status: perTest.every((t) => t.passed) ? 'passed' : 'failed', perTest, stdout: 'out', stderr: '', ...extra,
  };
}

export const signResult = (result: RunnerResult, key: KeyObject) => ({
  result,
  signature: sign(null, Buffer.from(canonicalResult(result)), key).toString('base64'),
});

export async function postResult(app: TestApp, r: TestRunner, signed: { result: RunnerResult; signature: string }) {
  return app.internal.inject({
    method: 'POST',
    url: '/internal/scheduler/results',
    headers: { authorization: `${RUNNER_AUTH_SCHEME} ${r.credential}`, [RUNNER_ID_HEADER]: r.id },
    payload: signed,
  });
}
