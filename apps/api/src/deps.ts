import type { Config } from './config';
import { createAnthropicProvider } from './ai/anthropic';
import { createGeminiProvider } from './ai/gemini';
import type { AiProvider } from './ai/provider';
import { createPgDb } from './db/db';
import { createSupabaseStore } from './storage/object-store';

/** Production adapters, selected by env. Tests build the app with their own adapters instead. */
export function productionDeps(config: Config) {
  const providers: Record<Config['AI_PROVIDER'], () => AiProvider> = {
    anthropic: () => createAnthropicProvider(config.ANTHROPIC_API_KEY!),
    gemini: () => createGeminiProvider({ apiKey: config.GEMINI_API_KEY!, baseUrl: config.AI_BASE_URL }),
  };
  return {
    config,
    db: createPgDb(config.DATABASE_URL),
    provider: providers[config.AI_PROVIDER](),
    store: createSupabaseStore(config),
  };
}
