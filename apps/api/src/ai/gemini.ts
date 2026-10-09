import { ProviderError, type AiProvider, type ProviderCall, type ProviderResult } from './provider';

/**
 * Google Gemini through its OpenAI-compatible endpoint, so the free tier works with a plain API key
 * from aistudio.google.com. Any other OpenAI-compatible host (Groq, OpenRouter, Ollama) also works by
 * setting AI_BASE_URL.
 */
export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

/** Gemini counts hidden "thinking" tokens against max_tokens, so leave headroom or answers get cut short. */
const THINKING_HEADROOM = 1500;
const RATE_LIMIT_WAIT_MAX_MS = 8_000;

type Fetch = typeof fetch;

interface Options {
  apiKey: string;
  baseUrl?: string;
  fetch?: Fetch;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); reject(new ProviderError('timeout', 'provider call timed out')); }, { once: true });
  });

export function createGeminiProvider({ apiKey, baseUrl = GEMINI_BASE_URL, fetch: doFetch = fetch }: Options): AiProvider {
  // Once a host rejects json_schema output we stop sending it and ask for JSON in the prompt instead.
  let schemaUnsupported = false;

  async function post(body: Record<string, unknown>, signal: AbortSignal, retried = false): Promise<Response> {
    let res: Response;
    try {
      res = await doFetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (signal.aborted) throw new ProviderError('timeout', 'provider call timed out');
      throw new ProviderError('unavailable', `provider unreachable (${err instanceof Error ? err.name : 'network'})`);
    }
    // Rate limits (429) and brief overloads (503) are common on the free tier. Wait once, then let the task runner retry.
    if ((res.status === 429 || res.status === 503) && !retried) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 2500;
      if (wait <= RATE_LIMIT_WAIT_MAX_MS) {
        await sleep(wait, signal);
        return post(body, signal, true);
      }
    }
    return res;
  }

  async function readStream(res: Response, onToken?: (d: string) => void): Promise<{ text: string; finish: string | null; usage?: { prompt_tokens?: number; completion_tokens?: number } }> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let text = '';
    let finish: string | null = null;
    let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const j = JSON.parse(payload) as { choices?: { delta?: { content?: string }; finish_reason?: string | null }[]; usage?: typeof usage };
          const c = j.choices?.[0];
          if (c?.delta?.content) { text += c.delta.content; onToken?.(c.delta.content); }
          if (c?.finish_reason) finish = c.finish_reason;
          if (j.usage) usage = j.usage;
        } catch { /* ignore a partial or keep-alive line */ }
      }
    }
    return { text, finish, usage };
  }

  return {
    name: 'gemini',
    async complete(call: ProviderCall): Promise<ProviderResult> {
      const wantJson = call.jsonSchema !== null;
      const withSchema = wantJson && !schemaUnsupported;
      const system = wantJson && !withSchema
        ? `${call.system}\n\nRespond with a single JSON object only, no prose and no code fences, matching this JSON Schema:\n${JSON.stringify(call.jsonSchema)}`
        : call.system;
      const stream = !wantJson && !!call.onToken;
      const base = {
        model: call.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: call.prompt }],
        max_tokens: call.maxTokens + THINKING_HEADROOM,
        stream,
        ...(stream ? { stream_options: { include_usage: true } } : {}),
      };
      const full = {
        ...base,
        reasoning_effort: call.effort,
        ...(wantJson
          ? { response_format: withSchema ? { type: 'json_schema', json_schema: { name: 'result', strict: true, schema: call.jsonSchema } } : { type: 'json_object' } }
          : {}),
      };

      let res = await post(full, call.signal);
      if (res.status === 400) {
        // Some models or hosts reject schema output or reasoning_effort. Fall back to the plainest request once.
        if (withSchema) schemaUnsupported = true;
        const plain = { ...base, messages: [{ role: 'system', content: wantJson ? `${call.system}\n\nRespond with a single JSON object only, no prose and no code fences, matching this JSON Schema:\n${JSON.stringify(call.jsonSchema)}` : call.system }, base.messages[1]], ...(wantJson ? { response_format: { type: 'json_object' } } : {}) };
        res = await post(plain, call.signal);
      }
      if (res.status === 401 || res.status === 403 || res.status === 400 || res.status === 404) {
        throw new ProviderError('bad_request', `provider rejected request (${res.status})`);
      }
      if (!res.ok) throw new ProviderError('unavailable', `provider error ${res.status}`);

      let text: string;
      let finish: string | null;
      let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
      let model = call.model;
      if (stream) {
        ({ text, finish, usage } = await readStream(res, call.onToken));
      } else {
        const j = (await res.json()) as { model?: string; choices?: { message?: { content?: string | null }; finish_reason?: string | null }[]; usage?: typeof usage };
        text = j.choices?.[0]?.message?.content ?? '';
        finish = j.choices?.[0]?.finish_reason ?? null;
        usage = j.usage;
        model = j.model ?? model;
      }
      if (finish === 'content_filter') throw new ProviderError('refusal', 'model declined the request');
      if (finish === 'length') throw new ProviderError('truncated', 'output hit max_tokens');
      if (wantJson) text = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
      return {
        text,
        model,
        tokensIn: usage?.prompt_tokens ?? Math.ceil((system.length + call.prompt.length) / 4),
        tokensOut: usage?.completion_tokens ?? Math.ceil(text.length / 4),
        costUsd: 0,
      };
    },
  };
}
