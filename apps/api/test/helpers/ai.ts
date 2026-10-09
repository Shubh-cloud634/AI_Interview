import { ProviderError, type AiProvider, type AiTaskName, type ProviderCall, type ProviderResult } from '../../src/ai/provider';

/** A scripted reply: model text, an object (sent as JSON), or an error to throw. */
export type Reply = string | object | ProviderError | Error;
type Responder = (call: ProviderCall) => Reply;

interface CriterionLike {
  id: string;
  levels: { score: number }[];
}

const asText = (r: Reply) => (typeof r === 'string' ? r : JSON.stringify(r));

/** A short verbatim span of the text, so evidence checks pass by default. */
const quoteOf = (s: string) => s.trim().split(/\s+/).slice(0, 6).join(' ');

/**
 * Default deterministic behavior per task. Reads only the typed task input, never the prompt, so
 * outputs do not depend on prompt wording and two runs with the same input give the same output.
 */
const DEFAULTS: Record<AiTaskName, Responder> = {
  generateQuestion: (c) => {
    const i = c.input as { kind: string; difficulty: number; previousQuestions: string[] };
    return `Generated ${i.kind} question at difficulty ${i.difficulty} (#${i.previousQuestions.length + 1}). Tell me about a recent challenge.`;
  },
  followUp: (c) => {
    const i = c.input as { transcript: unknown[] };
    return `Follow-up after ${i.transcript.length} lines: can you go deeper on that?`;
  },
  extractProfile: () => ({ headline: null, summary: null, experiences: [], education: [], skills: [] }),
  analyzeAnswer: (c) => {
    const i = c.input as { answer: string };
    return { observations: [{ quote: quoteOf(i.answer), note: 'relevant point' }] };
  },
  scoreStage: (c) => scoreAll(c, 'max'),
  reviewStage: (c) => scoreAll(c, 'max'),
  summarizeReport: () => ({ headline: 'Solid interview', narrative: 'The candidate communicated clearly and reasoned well.' }),
  matchRoles: (c) => {
    const i = c.input as { roles: { id: string }[]; resources: { id: string }[] };
    return {
      roles: i.roles.map((r) => ({ roleId: r.id, explanation: 'Matches the readiness profile.' })),
      resources: i.resources.slice(0, 2).map((r) => ({ resourceId: r.id, reason: 'Closes the largest gap.' })),
    };
  },
};

/** Scores every rubric criterion at its highest (or lowest) defined level with a verbatim quote. */
export function scoreAll(c: ProviderCall, pick: 'max' | 'min') {
  const i = c.input as { criteria: CriterionLike[]; answers: string[] };
  return {
    criteria: i.criteria.map((cr) => {
      const levels = cr.levels.map((l) => l.score);
      return {
        criterionId: cr.id,
        level: pick === 'max' ? Math.max(...levels) : Math.min(...levels),
        rationale: 'Meets the anchor.',
        evidence: [quoteOf(i.answers[0] ?? 'none')],
      };
    }),
  };
}

/**
 * Deterministic in-memory AiProvider. Every call is recorded. Per-task queues override the default
 * reply for the next N calls of that task; `always` overrides it until reset.
 */
export class TestAi implements AiProvider {
  readonly name = 'test';
  readonly calls: ProviderCall[] = [];
  private queues = new Map<AiTaskName, Reply[]>();
  private overrides = new Map<AiTaskName, Responder>();

  queue(task: AiTaskName, ...replies: Reply[]): this {
    this.queues.set(task, [...(this.queues.get(task) ?? []), ...replies]);
    return this;
  }

  always(task: AiTaskName, fn: Responder | Reply): this {
    this.overrides.set(task, typeof fn === 'function' && !(fn instanceof Error) ? (fn as Responder) : () => fn as Reply);
    return this;
  }

  reset(): void {
    this.calls.length = 0;
    this.queues.clear();
    this.overrides.clear();
  }

  callsOf(task: AiTaskName): ProviderCall[] {
    return this.calls.filter((c) => c.task === task);
  }

  async complete(call: ProviderCall): Promise<ProviderResult> {
    this.calls.push(call);
    const queued = this.queues.get(call.task);
    const reply = queued?.length ? queued.shift()! : (this.overrides.get(call.task) ?? DEFAULTS[call.task])(call);
    if (reply instanceof Error) throw reply;
    const text = asText(reply);
    if (call.onToken && !call.jsonSchema) for (const word of text.split(/(?<= )/)) call.onToken(word);
    return { text, model: `test-${call.model}`, tokensIn: 10, tokensOut: 10, costUsd: 0 };
  }
}

export const unavailable = () => new ProviderError('unavailable', 'test outage');
