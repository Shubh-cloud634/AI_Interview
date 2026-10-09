import { z } from 'zod';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/db';
import { AppError } from '../http/errors';
import type { Config } from '../config';
import { ProviderError, type AiProvider, type AiRole, type AiTaskName, type Effort, type ModelTier } from './provider';
import { render, type PromptSet } from './prompts';
import { DATA_RULE, dataBlock, newBoundary, screenInjection } from './untrusted';

/**
 * One AI task. Roles (interviewer, evaluator, career, candidate) each define their own tasks with their
 * own prompts and schemas; the runner only supplies mechanics: prompt rendering, data framing,
 * budget, timeout, bounded retry, validation and logging. It holds no business rules.
 */
export interface TaskDef<I, O> {
  role: AiRole;
  task: AiTaskName;
  promptRef: (input: I) => string;
  tier: ModelTier;
  effort: Effort;
  maxTokens: number;
  /** Trusted template variables (authored content, enums, numbers). */
  vars: (input: I) => Record<string, string>;
  /** Untrusted text, each framed as its own data block. */
  data: (input: I) => Record<string, string>;
  maxDataChars: number;
  /** Per-attempt timeout. Defaults to AI_TIMEOUT_MS; set lower for tasks that normally finish fast so a stalled call retries sooner. */
  timeoutMs?: number;
  /** 'text' tasks stream and must produce a string; JSON tasks use structured output. */
  output: 'text' | ((input: I) => z.ZodType<O>);
  /** Semantic checks zod cannot express. Return a rejection reason, or null to accept. */
  check?: (output: O, input: I) => string | null;
}

export class AiFailure extends AppError {
  constructor(readonly kind: 'budget' | 'unavailable' | 'rejected', detail: string) {
    super(
      kind === 'budget' ? 429 : 503,
      kind === 'budget' ? 'ai_budget_exceeded' : 'ai_unavailable',
      kind === 'budget' ? 'AI budget exceeded' : 'AI unavailable',
      detail,
    );
  }
}

export interface TaskResult<O> {
  output: O;
  promptVersion: string;
  model: string;
  injectionFlags: string[];
}

export interface AiContext {
  userId: string | null;
}

const UNSUPPORTED_SCHEMA_KEYS = new Set([
  '$schema', 'minLength', 'maxLength', 'pattern', 'format', 'minimum', 'maximum',
  'exclusiveMinimum', 'exclusiveMaximum', 'maxItems', 'minItems', 'multipleOf',
]);

/** Structured outputs accept a JSON Schema subset; zod still enforces the dropped constraints. */
export function toProviderSchema(schema: z.ZodType): Record<string, unknown> {
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) if (!UNSUPPORTED_SCHEMA_KEYS.has(k)) out[k] = strip(v);
    if (out.type === 'object') out.additionalProperties = false;
    return out;
  };
  return strip(z.toJSONSchema(schema, { io: 'output' })) as Record<string, unknown>;
}

const TEXT_OUTPUT = z.string().trim().min(1).max(4000);

export type TaskRunner = <I, O>(
  def: TaskDef<I, O>,
  input: I,
  ctx: AiContext,
  opts?: { onToken?: (delta: string) => void },
) => Promise<TaskResult<O>>;

export function createTaskRunner(deps: { provider: AiProvider; db: Db; prompts: PromptSet; config: Config; log: FastifyBaseLogger }): TaskRunner {
  const { provider, db, prompts, config, log } = deps;
  const models: Record<ModelTier, string> = { primary: config.AI_MODEL, review: config.AI_REVIEW_MODEL };

  async function overBudget(userId: string): Promise<boolean> {
    const [row] = await db.query<{ used: number }>(
      `select coalesce(sum(tokens_in + tokens_out), 0)::int as used from ai_calls
       where user_id = $1 and created_at > now() - interval '1 day'`,
      [userId],
    );
    return (row?.used ?? 0) >= config.AI_DAILY_TOKEN_BUDGET;
  }

  return async function run<I, O>(def: TaskDef<I, O>, input: I, ctx: AiContext, opts: { onToken?: (d: string) => void } = {}) {
    if (ctx.userId && (await overBudget(ctx.userId))) throw new AiFailure('budget', 'daily AI budget exhausted');

    const ref = def.promptRef(input);
    const template = prompts.get(ref);
    if (!template) throw new Error(`unknown prompt ${ref}`);
    const schema = def.output === 'text' ? null : def.output(input);
    const boundary = newBoundary();
    const system = `${render(template, def.vars(input))}\n\n${DATA_RULE(boundary)}`;
    const data = def.data(input);
    const injectionFlags = [...new Set(Object.values(data).flatMap(screenInjection))];
    if (injectionFlags.length) log.warn({ task: def.task, injectionFlags }, 'possible prompt injection in candidate data (treated as data)');
    const blocks = Object.entries(data).map(([name, text]) => dataBlock(name, text, boundary, def.maxDataChars));
    const basePrompt = `${blocks.join('\n\n')}\n\nComplete the task described in the system instructions using the data above.`;
    const model = models[def.tier];
    const jsonSchema = schema ? toProviderSchema(schema) : null;

    const started = Date.now();
    let tokensIn = 0;
    let tokensOut = 0;
    let cost = 0;
    let usedModel = model;
    let attempts = 0;
    let lastReason = '';
    let errorKind: string | null = null;
    let output: O | undefined;

    for (; attempts <= config.AI_MAX_RETRIES && output === undefined; ) {
      attempts++;
      const prompt = lastReason ? `${basePrompt}\n\nYour previous output was rejected: ${lastReason}. Produce a corrected output.` : basePrompt;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), def.timeoutMs ?? config.AI_TIMEOUT_MS);
      try {
        const res = await provider.complete({
          task: def.task, model, effort: def.effort, system, prompt, jsonSchema,
          maxTokens: def.maxTokens, signal: controller.signal, onToken: opts.onToken, input,
        });
        tokensIn += res.tokensIn;
        tokensOut += res.tokensOut;
        cost += res.costUsd;
        usedModel = res.model;
        let candidate: unknown;
        if (schema) {
          try {
            candidate = JSON.parse(res.text);
          } catch {
            lastReason = 'output was not valid JSON';
            errorKind = 'invalid_json';
            continue;
          }
        } else {
          candidate = res.text;
        }
        const parsed = (schema ?? TEXT_OUTPUT).safeParse(candidate);
        if (!parsed.success) {
          lastReason = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'output'}: ${i.message}`).join('; ');
          errorKind = 'schema';
          continue;
        }
        const rejected = def.check?.(parsed.data as O, input) ?? null;
        if (rejected) {
          lastReason = rejected;
          errorKind = 'check';
          continue;
        }
        output = parsed.data as O;
        errorKind = null;
      } catch (err) {
        const kind = err instanceof ProviderError ? err.kind : controller.signal.aborted ? 'timeout' : 'unavailable';
        errorKind = kind;
        lastReason = '';
        if (kind === 'refusal' || kind === 'bad_request') break;
      } finally {
        clearTimeout(timer);
      }
    }

    await db
      .query(
        `insert into ai_calls (user_id, role, task, prompt_version, model, tokens_in, tokens_out, cost, latency_ms, ok, attempts, error_kind, injection_flags)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [ctx.userId, def.role, def.task, ref, usedModel, tokensIn, tokensOut, cost, Date.now() - started, output !== undefined, attempts, errorKind, injectionFlags],
      )
      .catch((err) => log.error({ err, task: def.task }, 'ai_calls insert failed'));

    if (output === undefined) {
      const rejected = errorKind === 'schema' || errorKind === 'check' || errorKind === 'invalid_json';
      throw new AiFailure(rejected ? 'rejected' : 'unavailable', `${def.task} failed after ${attempts} attempt(s): ${errorKind}`);
    }
    return { output, promptVersion: ref, model: usedModel, injectionFlags };
  };
}
