import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { SessionStatus } from '@ai-interview/shared';
import { transition, type EngineEvent } from '../src/modules/interview/machine';
import { createTestApp, seeded, type TestApp, type TestUser } from './helpers/app';
import { unavailable } from './helpers/ai';
import { answer, getState, runToCompletion, startSession } from './helpers/flows';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');

describe('state machine (pure)', () => {
  const statuses: SessionStatus[] = ['created', 'in_stage', 'awaiting_answer', 'processing', 'completed', 'abandoned'];
  const events: EngineEvent['type'][] = ['start', 'ask', 'answer', 'follow_up', 'complete_stage', 'end'];
  // The only legal transitions. Everything else must throw invalid_state.
  const legal: Record<string, SessionStatus> = {
    'created/start': 'in_stage',
    'in_stage/ask': 'awaiting_answer',
    'awaiting_answer/answer': 'processing',
    'processing/follow_up': 'awaiting_answer',
    'processing/complete_stage': 'in_stage',
    'created/end': 'abandoned',
    'in_stage/end': 'abandoned',
    'awaiting_answer/end': 'abandoned',
    'processing/end': 'abandoned',
  };

  for (const s of statuses) {
    for (const e of events) {
      const key = `${s}/${e}`;
      test(key, () => {
        const go = () => transition({ status: s, stageIdx: s === 'created' ? null : 0 }, { type: e } as EngineEvent, 3);
        if (legal[key]) expect(go().status).toBe(legal[key]);
        else expect(go).toThrow(expect.objectContaining({ code: 'invalid_state', status: 409 }));
      });
    }
  }

  test('complete_stage on the last stage completes the session', () => {
    expect(transition({ status: 'processing', stageIdx: 2 }, { type: 'complete_stage' }, 3)).toEqual({ status: 'completed', stageIdx: 2 });
    expect(transition({ status: 'processing', stageIdx: 1 }, { type: 'complete_stage' }, 3)).toEqual({ status: 'in_stage', stageIdx: 2 });
  });
});

let t: TestApp;
let u: TestUser;
let mode: (slug: string) => string;
beforeAll(async () => {
  t = await createTestApp();
  mode = (await seeded(t.db)).mode;
  u = await t.user();
});
afterAll(() => t.close());

describe('session lifecycle over HTTP', () => {
  test('stages advance in order, follow-ups respect maxTurns, and the session completes after the last stage', async () => {
    const s = await startSession(t, u, mode('case-interview'));
    expect(s.status).toBe('awaiting_answer');
    expect(s.stages.map((x) => x.status)).toEqual(['active', 'pending', 'pending']);
    const seen: string[] = [];
    let st = await getState(t, u, s.id);
    while (st.status !== 'completed') {
      seen.push(`${st.currentStage!.idx}:${st.currentStage!.kind}`);
      await answer(t, u, s.id);
      st = await getState(t, u, s.id);
    }
    // fit: maxTurns default 1; case: 3; math: 2.
    expect(seen).toEqual(['0:conversation', '1:case', '1:case', '1:case', '2:quant', '2:quant']);
    const final = await t.call(u, { method: 'GET', url: `/v1/sessions/${s.id}` });
    expect(final.json.status).toBe('completed');
    expect(final.json.endedAt).not.toBeNull();
    expect(final.json.stages.map((x: { status: string }) => x.status)).toEqual(['completed', 'completed', 'completed']);
    const jobs = await t.db.query<{ name: string }>(`select name from jobs where payload->>'sessionId' = $1 or singleton_key like 'evaluate_stage:%'`, [s.id]);
    expect(jobs.filter((j) => j.name === 'finalize_evaluation')).toHaveLength(1);
  });

  test('no turns after completion', async () => {
    const s = await startSession(t, u, mode('case-interview'));
    await runToCompletion(t, u, s.id);
    const { nextSeq } = await getState(t, u, s.id);
    const res = await t.call(u, { method: 'POST', url: `/v1/sessions/${s.id}/turns`, payload: { seq: nextSeq, content: { type: 'text', text: 'late' } } });
    expect(res.statusCode).toBe(409);
    expect(res.json.code).toBe('invalid_state');
  });

  test('end abandons, is idempotent, skips open stages and blocks further turns', async () => {
    const s = await startSession(t, u, mode('case-interview'));
    const ended = await t.call(u, { method: 'POST', url: `/v1/sessions/${s.id}/end` });
    expect(ended.json.status).toBe('abandoned');
    expect(ended.json.stages.map((x: { status: string }) => x.status)).toEqual(['skipped', 'skipped', 'skipped']);
    const again = await t.call(u, { method: 'POST', url: `/v1/sessions/${s.id}/end` });
    expect(again.statusCode).toBe(200);
    expect(again.json.status).toBe('abandoned');
    const res = await t.call(u, { method: 'POST', url: `/v1/sessions/${s.id}/turns`, payload: { seq: 2, content: { type: 'text', text: 'x' } } });
    expect(res.statusCode).toBe(409);
    expect(res.json.code).toBe('invalid_state');
  });

  test('ending a completed session keeps it completed', async () => {
    const s = await startSession(t, u, mode('case-interview'));
    await runToCompletion(t, u, s.id);
    const res = await t.call(u, { method: 'POST', url: `/v1/sessions/${s.id}/end` });
    expect(res.json.status).toBe('completed');
  });

  test('an AI outage mid-turn leaves the session resumable at the same seq', async () => {
    const s = await startSession(t, u, mode('case-interview'));
    const { nextSeq } = await getState(t, u, s.id);
    // Answering stage 0 (maxTurns 1) generates nothing (stage 1 is from the bank), so use stage 1's follow-up.
    await answer(t, u, s.id);
    const st = await getState(t, u, s.id);
    expect(st.nextSeq).toBe(nextSeq + 2);
    t.ai.queue('followUp', unavailable(), unavailable(), unavailable());
    const payload = { seq: st.nextSeq, content: { type: 'text', text: 'case answer' } };
    const failed = await t.call(u, { method: 'POST', url: `/v1/sessions/${s.id}/turns`, payload });
    expect(failed.statusCode).toBe(503);
    expect(failed.json.code).toBe('ai_unavailable');
    expect((await getState(t, u, s.id)).status).toBe('processing');
    // A different answer at that seq is refused; the same one resumes.
    const other = await t.call(u, { method: 'POST', url: `/v1/sessions/${s.id}/turns`, payload: { ...payload, content: { type: 'text', text: 'changed' } } });
    expect(other.json.code).toBe('seq_conflict');
    const retry = await t.call(u, { method: 'POST', url: `/v1/sessions/${s.id}/turns`, payload });
    expect(retry.statusCode).toBe(200);
    expect(retry.json.interviewerTurn.content.type).toBe('follow_up');
    expect(retry.json.state.status).toBe('awaiting_answer');
  });
});

describe('domain packs are data: one engine for every domain', () => {
  test('engineering and consulting modes run end to end through the same code', async () => {
    const runs: Record<string, string[]> = {};
    for (const slug of ['case-interview', 'system-design']) {
      const s = await startSession(t, u, mode(slug));
      runs[slug] = (await runToCompletion(t, u, s.id)).kinds;
    }
    await t.drain();
    expect(new Set(runs['case-interview'])).toEqual(new Set(['conversation', 'case', 'quant']));
    expect(new Set(runs['system-design'])).toEqual(new Set(['whiteboard']));
    const reports = await t.db.query<{ domain: string }>(
      `select d.slug as domain from reports r join evaluations e on e.id = r.evaluation_id join sessions s on s.id = e.session_id
       join mode_versions mv on mv.id = s.mode_version_id join modes m on m.id = mv.mode_id join packs p on p.id = m.pack_id
       join domains d on d.id = p.domain_id where s.user_id = $1`,
      [u.id],
    );
    expect(new Set(reports.map((r) => r.domain))).toEqual(new Set(['engineering', 'consulting']));
  });

  test('no source file branches on a domain, pack or mode slug', async () => {
    const [{ slugs }] = (await t.db.query<{ slugs: string[] }>(
      `select array_agg(distinct s) as slugs from (
         select slug as s from domains union select slug from packs union select slug from modes) x`,
      [],
    )) as [{ slugs: string[] }];
    // Also the domains the architecture names, so a future pack slug cannot sneak in either.
    const names = [...new Set([...slugs, 'engineering', 'consulting', 'mba', 'finance', 'marketing', 'data'])];
    // A slug as a string literal, or a comparison against any .slug / domain field.
    const literal = new RegExp(`['"\`](${names.map((n) => n.replace(/[-]/g, '\\-')).join('|')})['"\`]`, 'i');
    const comparison = /\b(domain\w*|slug)\s*(===|!==|==|!=)\s*['"`]|['"`]\s*(===|!==)\s*\w*(domain|slug)\b|case\s+['"`](engineering|consulting)/i;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) {
          readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
            if (literal.test(line) || comparison.test(line)) offenders.push(`${p.slice(SRC.length + 1)}:${i + 1}: ${line.trim()}`);
          });
        }
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });
});
