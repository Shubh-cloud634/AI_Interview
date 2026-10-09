import { describe, expect, test } from 'vitest';
import { ProviderError, type AiProvider, type ProviderCall } from '../src/ai/provider';
import { buildApp } from '../src/app';
import { productionDeps } from '../src/deps';
import { MemoryStore } from './helpers/store';
import { TestAi } from './helpers/ai';
import { createTestDb } from './helpers/db';
import { testConfig } from './helpers/app';
import { mintToken } from './helpers/tokens';

describe('AI provider port', () => {
  test('any AiProvider plugs into buildApp; every AI call goes through it and its model is recorded', async () => {
    const inner = new TestAi();
    const seen: ProviderCall['task'][] = [];
    const custom: AiProvider = {
      name: 'custom',
      complete: async (call) => {
        seen.push(call.task);
        return { ...(await inner.complete(call)), model: 'custom-model-1' };
      },
    };
    const db = await createTestDb();
    const { app, jobs } = await buildApp({ config: testConfig(), db, provider: custom, store: new MemoryStore(), logger: false });
    const [mode] = await db.query<{ id: string }>(`select id from modes where slug = 'system-design'`, []);
    const headers = { authorization: `Bearer ${await mintToken()}` };

    const s = (await app.inject({ method: 'POST', url: '/v1/sessions', headers, payload: { modeId: mode!.id } })).json();
    for (let i = 0; i < 3; i++) {
      const st = (await app.inject({ method: 'GET', url: `/v1/sessions/${s.id}/state`, headers })).json();
      await app.inject({ method: 'POST', url: `/v1/sessions/${s.id}/turns`, headers, payload: { seq: st.nextSeq, content: { type: 'text', text: 'I would add a cache in front of the database.' } } });
    }
    const [sr] = await db.query<{ id: string }>('select id from stage_runs where session_id = $1', [s.id]);
    await jobs.evaluate_stage({ stageRunId: sr!.id });

    expect(seen).toEqual(expect.arrayContaining(['followUp', 'analyzeAnswer', 'scoreStage', 'reviewStage']));
    const models = await db.query<{ model: string }>('select distinct model from ai_calls', []);
    expect(models.map((m) => m.model)).toEqual(['custom-model-1']);
    const [se] = await db.query<{ model: string }>('select model from stage_evaluations where stage_run_id = $1', [sr!.id]);
    expect(se!.model).toBe('custom-model-1+custom-model-1');
    await app.close();
    await db.close();
  });

  test('a rate-limited main model falls back to the review model, and is skipped afterwards', async () => {
    const inner = new TestAi();
    const calls: string[] = [];
    const limited: AiProvider = {
      name: 'limited',
      complete: async (call) => {
        calls.push(call.model);
        if (call.model === 'main-model') throw new ProviderError('rate_limited', 'quota');
        return { ...(await inner.complete(call)), model: call.model };
      },
    };
    const db = await createTestDb();
    const config = testConfig({ AI_MODEL: 'main-model', AI_REVIEW_MODEL: 'review-model' });
    const { app } = await buildApp({ config, db, provider: limited, store: new MemoryStore(), logger: false });
    const [mode] = await db.query<{ id: string }>(`select id from modes where slug = 'hr-interview' limit 1`, []);
    const headers = { authorization: `Bearer ${await mintToken()}` };

    const first = await app.inject({ method: 'POST', url: '/v1/sessions', headers, payload: { modeId: mode!.id } });
    expect(first.statusCode, first.body).toBe(201);
    // One failed try on the main model, then the review model answered.
    expect(calls).toEqual(['main-model', 'review-model']);

    calls.length = 0;
    const second = await app.inject({ method: 'POST', url: '/v1/sessions', headers, payload: { modeId: mode!.id } });
    expect(second.statusCode, second.body).toBe(201);
    // The limited model is in its cooldown, so it is not called again.
    expect(calls).toEqual(['review-model']);
    await app.close();
    await db.close();
  });

  test('production wiring picks the provider from AI_PROVIDER and makes no network call to build it', () => {
    const deps = productionDeps(testConfig({ ANTHROPIC_API_KEY: 'sk-test-placeholder' }));
    expect(deps.provider.name).toBe('anthropic');
    void deps.db.close();
  });

  test('an unknown provider is a startup error', () => {
    expect(() => testConfig({ AI_PROVIDER: 'nope' })).toThrow(/AI_PROVIDER/);
  });
});
