import { z } from 'zod';

const secret = z.string().min(32);

/** Model ids per provider. Override with AI_MODEL and AI_REVIEW_MODEL when a provider renames or retires one. */
const AI_MODEL_DEFAULTS = {
  anthropic: { primary: 'claude-opus-5-5', review: 'claude-sonnet-5-5' },
  // "-latest" aliases follow Google's current model, so retired versions do not break new accounts.
  gemini: { primary: 'gemini-flash-latest', review: 'gemini-flash-lite-latest' },
} as const;

export const Env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    /**
     * Exact browser origins allowed by CORS, comma separated (`https://app.example.com`). No wildcard:
     * @fastify/cors turns any list containing `*` into allow-all. Required in production.
     */
    CORS_ORIGINS: z
      .string()
      .optional()
      .transform((s) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean))
      .pipe(z.array(z.string().refine(isExactOrigin, 'must be an exact origin like https://app.example.com (no wildcard, path or trailing slash)'))),
    /** Set when behind a load balancer that overwrites X-Forwarded-For; otherwise req.ip is spoofable. */
    TRUST_PROXY: z.stringbool().default(false),

    DATABASE_URL: z.string().startsWith('postgres'),
    WORKERS_ENABLED: z.stringbool().default(true),

    SUPABASE_URL: z.url(),
    /** Legacy HS256 projects. When unset, tokens are verified against the project's JWKS. */
    SUPABASE_JWT_SECRET: secret.optional(),
    /** Server-only. Used for storage presigning and auth-user deletion. */
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    RESUME_BUCKET: z.string().default('resumes'),

    AI_PROVIDER: z.enum(['anthropic', 'gemini']).default('anthropic'),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    /** Free key from aistudio.google.com. Also works for other OpenAI-compatible hosts with AI_BASE_URL. */
    GEMINI_API_KEY: z.string().min(1).optional(),
    AI_BASE_URL: z.url().optional(),
    /** Default depends on the provider, see AI_MODEL_DEFAULTS. */
    AI_MODEL: z.string().min(1).optional(),
    /** Second, independent evaluator pass. */
    AI_REVIEW_MODEL: z.string().min(1).optional(),
    AI_TIMEOUT_MS: z.coerce.number().int().min(1000).default(45_000),
    AI_MAX_RETRIES: z.coerce.number().int().min(0).max(4).default(2),
    AI_DAILY_TOKEN_BUDGET: z.coerce.number().int().min(0).default(300_000),
    AI_REVIEW_MIN_STAGE_WEIGHT: z.coerce.number().min(0).max(1).default(0.3),
    AI_DISAGREEMENT_THRESHOLD: z.coerce.number().min(0).max(1).default(0.25),

    /** Scheduler contract listener. Bind to the runner network only; never expose publicly. */
    INTERNAL_HOST: z.string().default('127.0.0.1'),
    INTERNAL_PORT: z.coerce.number().int().default(4001),
    RUN_RESULT_WAIT_MS: z.coerce.number().int().min(0).default(120_000),

    RATE_LIMIT_GLOBAL_PER_MIN: z.coerce.number().int().min(1).default(300),
    RATE_LIMIT_AI_PER_MIN: z.coerce.number().int().min(1).default(20),
    RATE_LIMIT_RUN_PER_MIN: z.coerce.number().int().min(1).default(10),
  })
  .superRefine((e, ctx) => {
    const require = (key: keyof typeof e, message: string) => ctx.addIssue({ code: 'custom', path: [key], message });
    if (e.AI_PROVIDER === 'anthropic' && e.NODE_ENV !== 'test' && !e.ANTHROPIC_API_KEY) {
      require('ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic');
    }
    if (e.AI_PROVIDER === 'gemini' && e.NODE_ENV !== 'test' && !e.GEMINI_API_KEY) {
      require('GEMINI_API_KEY', 'GEMINI_API_KEY is required when AI_PROVIDER=gemini (free key at aistudio.google.com)');
    }
    if (e.NODE_ENV !== 'production') return;
    // Production fails fast at boot instead of on the first request that needs a missing secret.
    if (!e.SUPABASE_SERVICE_ROLE_KEY) require('SUPABASE_SERVICE_ROLE_KEY', 'required in production (storage and account deletion)');
    if (e.CORS_ORIGINS.length === 0) require('CORS_ORIGINS', 'required in production');
    if (e.CORS_ORIGINS.some((o) => !o.startsWith('https://'))) require('CORS_ORIGINS', 'production origins must be https');
    if (!e.SUPABASE_URL.startsWith('https://')) require('SUPABASE_URL', 'must be https in production');
  })
  .transform((e) => ({
    ...e,
    AI_MODEL: e.AI_MODEL ?? AI_MODEL_DEFAULTS[e.AI_PROVIDER].primary,
    AI_REVIEW_MODEL: e.AI_REVIEW_MODEL ?? AI_MODEL_DEFAULTS[e.AI_PROVIDER].review,
    CORS_ORIGINS: e.CORS_ORIGINS.length || e.NODE_ENV === 'production' ? e.CORS_ORIGINS : ['http://localhost:3000'],
  }));

function isExactOrigin(o: string): boolean {
  try {
    const u = new URL(o);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.origin === o;
  } catch {
    return false;
  }
}

export type Config = z.infer<typeof Env>;

/** Parse once at startup. Error messages name the variable, never its value. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
