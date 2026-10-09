import { z } from 'zod';

// created and in_stage are transient inside one engine transition; clients normally see
// awaiting_answer, processing, completed or abandoned.
export const SessionStatus = z.enum(['created', 'in_stage', 'awaiting_answer', 'processing', 'completed', 'abandoned']);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const StageKind = z.enum(['conversation', 'coding', 'case', 'quant', 'document', 'whiteboard']);
export type StageKind = z.infer<typeof StageKind>;

export const StageRunStatus = z.enum(['pending', 'active', 'completed', 'skipped']);
export type StageRunStatus = z.infer<typeof StageRunStatus>;

export const TurnActor = z.enum(['interviewer', 'candidate']);
export type TurnActor = z.infer<typeof TurnActor>;

export const ResumeStatus = z.enum(['awaiting_upload', 'uploaded', 'parsing', 'parsed', 'failed']);
export type ResumeStatus = z.infer<typeof ResumeStatus>;

export const EvaluationStatus = z.enum(['pending', 'ready', 'failed']);
export type EvaluationStatus = z.infer<typeof EvaluationStatus>;

export const RunJobStatus = z.enum(['queued', 'leased', 'completed', 'failed']);
export type RunJobStatus = z.infer<typeof RunJobStatus>;

/** Outcome of one sandbox run. Each limit has a distinct status. */
export const RunStatus = z.enum([
  'passed',
  'failed',
  'compile_error',
  'runtime_error',
  'timeout',
  'memory_limit',
  'output_limit',
  'internal_error',
]);
export type RunStatus = z.infer<typeof RunStatus>;

export const RunSuite = z.enum(['visible', 'full']);
export type RunSuite = z.infer<typeof RunSuite>;

export const UserRole = z.enum(['candidate', 'org_member', 'pack_author', 'admin']);
export type UserRole = z.infer<typeof UserRole>;

export const RecommendationType = z.enum(['domain', 'role_match', 'gap', 'learning_path', 'next_mode']);
export type RecommendationType = z.infer<typeof RecommendationType>;

export const ReadinessStream = z.enum(['resume', 'interview', 'coding']);
export type ReadinessStream = z.infer<typeof ReadinessStream>;

export const ResumeContentType = z.enum([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);
export type ResumeContentType = z.infer<typeof ResumeContentType>;

export const ErrorCode = z.enum([
  'validation_failed',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'seq_conflict',
  'invalid_state',
  'rate_limited',
  'ai_budget_exceeded',
  'ai_unavailable',
  'payload_too_large',
  'internal',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;
