import Anthropic from '@anthropic-ai/sdk';
import { ProviderError, type AiProvider, type ProviderCall, type ProviderResult } from './provider';

// USD per million tokens (input, output). Unknown models log zero cost rather than guessing.
const PRICES: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-4-5': [1, 5],
};

export function createAnthropicProvider(apiKey: string): AiProvider {
  // Retries belong to the task runner, which also re-validates output; the SDK must not double them.
  const client = new Anthropic({ apiKey, maxRetries: 0 });

  return {
    name: 'anthropic',
    async complete(call: ProviderCall): Promise<ProviderResult> {
      try {
        const stream = client.beta.messages.stream(
          {
            model: call.model,
            max_tokens: call.maxTokens,
            system: call.system,
            messages: [{ role: 'user', content: call.prompt }],
            output_config: {
              effort: call.effort,
              ...(call.jsonSchema ? { format: { type: 'json_schema', schema: call.jsonSchema } } : {}),
            },
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
          },
          { signal: call.signal },
        );
        if (call.onToken && !call.jsonSchema) stream.on('text', (delta) => call.onToken?.(delta));
        const msg = await stream.finalMessage();
        if (msg.stop_reason === 'refusal') throw new ProviderError('refusal', 'model declined the request');
        if (msg.stop_reason === 'max_tokens') throw new ProviderError('truncated', 'output hit max_tokens');
        const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
        const [pin, pout] = PRICES[msg.model] ?? [0, 0];
        const tokensIn = msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0);
        const tokensOut = msg.usage.output_tokens;
        return { text, model: msg.model, tokensIn, tokensOut, costUsd: (tokensIn * pin + tokensOut * pout) / 1e6 };
      } catch (err) {
        if (err instanceof ProviderError) throw err;
        if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
          throw new ProviderError('bad_request', `provider rejected request (${err.status})`);
        }
        if (err instanceof Anthropic.APIUserAbortError) throw new ProviderError('timeout', 'provider call timed out');
        if (err instanceof Anthropic.APIError) throw new ProviderError('unavailable', `provider error ${err.status ?? 'network'}`);
        throw new ProviderError('unavailable', 'provider call failed');
      }
    },
  };
}
