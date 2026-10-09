/** The single port to an LLM provider. Only adapters implement it; only the task runner calls it. */

export type AiRole = 'interviewer' | 'evaluator' | 'career' | 'candidate';

export type AiTaskName =
  | 'extractProfile'
  | 'generateQuestion'
  | 'followUp'
  | 'analyzeAnswer'
  | 'scoreStage'
  | 'reviewStage'
  | 'summarizeReport'
  | 'matchRoles';

export type ModelTier = 'primary' | 'review';
export type Effort = 'low' | 'medium' | 'high';

export interface ProviderCall {
  task: AiTaskName;
  model: string;
  effort: Effort;
  system: string;
  /** User message: trusted instruction plus delimited untrusted data blocks. */
  prompt: string;
  /** JSON Schema for structured output, or null for free text. */
  jsonSchema: Record<string, unknown> | null;
  maxTokens: number;
  signal: AbortSignal;
  onToken?: (delta: string) => void;
  /** The typed task input. Real adapters ignore it; the deterministic test adapter reads it. */
  input: unknown;
}

export interface ProviderResult {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface AiProvider {
  readonly name: string;
  complete(call: ProviderCall): Promise<ProviderResult>;
}

/** Transient provider failure (network, 5xx, overload, timeout, rate limit). Retryable; a rate limit is worth retrying on another model. */
export class ProviderError extends Error {
  constructor(
    readonly kind: 'timeout' | 'unavailable' | 'rate_limited' | 'refusal' | 'truncated' | 'bad_request',
    message: string,
  ) {
    super(message);
  }
}
