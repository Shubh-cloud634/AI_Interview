import { describe, expect, test } from 'vitest';
import { createGeminiProvider } from '../src/ai/gemini';
import { ProviderError, type ProviderCall } from '../src/ai/provider';
import { loadConfig } from '../src/config';

const call = (over: Partial<ProviderCall> = {}): ProviderCall => ({
  task: 'followUp', model: 'gemini-flash-latest', effort: 'low', system: 'sys', prompt: 'hi', jsonSchema: null,
  maxTokens: 500, signal: new AbortController().signal, input: null, ...over,
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const ok = (content: string, finish = 'stop') => json({ model: 'gemini-2.5-flash', choices: [{ message: { content }, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 5 } });

function fake(...responses: (Response | (() => Response))[]) {
  const seen: { url: string; body: any; auth: string }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    seen.push({ url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).authorization! });
    const r = responses.shift()!;
    return typeof r === 'function' ? r() : r;
  }) as unknown as typeof fetch;
  return { f, seen };
}

describe('gemini provider', () => {
  test('sends a bearer key to the OpenAI-compatible endpoint and returns text with usage', async () => {
    const { f, seen } = fake(ok('hello'));
    const r = await createGeminiProvider({ apiKey: 'k', fetch: f }).complete(call());
    expect(r).toMatchObject({ text: 'hello', tokensIn: 10, tokensOut: 5, costUsd: 0 });
    expect(seen[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    expect(seen[0]!.auth).toBe('Bearer k');
    expect(seen[0]!.body.max_tokens).toBeGreaterThan(500); // headroom for thinking tokens
  });

  test('requests json_schema output and strips code fences from the reply', async () => {
    const { f, seen } = fake(ok('```json\n{"a":1}\n```'));
    const r = await createGeminiProvider({ apiKey: 'k', fetch: f }).complete(call({ jsonSchema: { type: 'object' } }));
    expect(seen[0]!.body.response_format.type).toBe('json_schema');
    expect(JSON.parse(r.text)).toEqual({ a: 1 });
  });

  test('falls back to json_object with the schema in the prompt when the host rejects json_schema, and remembers it', async () => {
    const { f, seen } = fake(json({ error: 'bad' }, 400), ok('{"a":1}'), ok('{"a":2}'));
    const p = createGeminiProvider({ apiKey: 'k', fetch: f });
    await p.complete(call({ jsonSchema: { type: 'object' } }));
    expect(seen[1]!.body.response_format.type).toBe('json_object');
    expect(seen[1]!.body.messages[0].content).toContain('JSON Schema');
    await p.complete(call({ jsonSchema: { type: 'object' } }));
    expect(seen).toHaveLength(3); // the second call went straight to the fallback
    expect(seen[2]!.body.response_format.type).toBe('json_object');
  });

  test('streams tokens for free-text tasks', async () => {
    const sse = ['{"choices":[{"delta":{"content":"Hel"}}]}', '{"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}']
      .map((l) => `data: ${l}\n\n`).join('') + 'data: [DONE]\n\n';
    const { f } = fake(new Response(sse, { headers: { 'content-type': 'text/event-stream' } }));
    const got: string[] = [];
    const r = await createGeminiProvider({ apiKey: 'k', fetch: f }).complete(call({ onToken: (d) => got.push(d) }));
    expect(got).toEqual(['Hel', 'lo']);
    expect(r).toMatchObject({ text: 'Hello', tokensIn: 3, tokensOut: 2 });
  });

  test('maps failures to retryable or terminal provider errors', async () => {
    const kind = async (res: Response) => {
      const { f } = fake(res, res);
      return createGeminiProvider({ apiKey: 'k', fetch: f }).complete(call()).catch((e: ProviderError) => e.kind);
    };
    expect(await kind(json({}, 401))).toBe('bad_request');
    expect(await kind(json({}, 500))).toBe('unavailable');
    expect(await kind(ok('', 'length'))).toBe('truncated');
    expect(await kind(ok('', 'content_filter'))).toBe('refusal');
  });

  test('waits out a brief overload (503) once, then succeeds', async () => {
    const { f, seen } = fake(json({}, 503, { 'retry-after': '0.01' }), ok('recovered'));
    const r = await createGeminiProvider({ apiKey: 'k', fetch: f }).complete(call());
    expect(r.text).toBe('recovered');
    expect(seen).toHaveLength(2);
  });

  test('waits out a short rate limit once, then succeeds', async () => {
    const { f, seen } = fake(json({}, 429, { 'retry-after': '0.01' }), ok('after wait'));
    const r = await createGeminiProvider({ apiKey: 'k', fetch: f }).complete(call());
    expect(r.text).toBe('after wait');
    expect(seen).toHaveLength(2);
  });
});

describe('gemini config', () => {
  const base = { DATABASE_URL: 'postgres://x', SUPABASE_URL: 'http://localhost:54321' };
  test('requires GEMINI_API_KEY and defaults the models', () => {
    expect(() => loadConfig({ ...base, AI_PROVIDER: 'gemini', NODE_ENV: 'development' })).toThrow(/GEMINI_API_KEY/);
    const c = loadConfig({ ...base, AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'k', NODE_ENV: 'development' });
    expect(c.AI_MODEL).toBe('gemini-flash-latest');
    expect(c.AI_REVIEW_MODEL).toBe('gemini-flash-lite-latest');
  });
  test('keeps Claude defaults for the anthropic provider and honours overrides', () => {
    expect(loadConfig({ ...base, ANTHROPIC_API_KEY: 'k', NODE_ENV: 'development' }).AI_MODEL).toBe('claude-opus-5-5');
    expect(loadConfig({ ...base, AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'k', AI_MODEL: 'custom', NODE_ENV: 'development' }).AI_MODEL).toBe('custom');
  });
});
