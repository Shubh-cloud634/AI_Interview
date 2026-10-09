import { z } from 'zod';
import { StageKind } from './enums';

/** `name.vN`. Resolved against prompt files or rubric rows, never used as a path directly. */
export const VersionedRef = z.string().regex(/^[a-z0-9][a-z0-9-]*\.v\d+$/, 'expected name.vN');
export const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'expected lowercase slug').max(64);
export const Difficulty = z.int().min(1).max(5);

export const QuestionSource = z.discriminatedUnion('type', [
  z.object({ type: z.literal('generated'), promptRef: VersionedRef, difficulty: Difficulty.optional() }),
  z.object({ type: z.literal('bank'), tags: z.array(z.string().min(1)).min(1), difficulty: Difficulty.optional() }),
]);
export type QuestionSource = z.infer<typeof QuestionSource>;

export const StageSpec = z.object({
  id: Slug,
  kind: StageKind,
  questionSource: QuestionSource,
  rubricRef: VersionedRef,
  /** Candidate answers allowed in this stage before it completes. Defaults to 1. */
  maxTurns: z.int().min(1).max(10).optional(),
  /** Server-enforced stage deadline, counted from the stage start. */
  timeLimitSec: z.int().min(30).max(4 * 3600).optional(),
  weight: z.number().gt(0).max(1),
});
export type StageSpec = z.infer<typeof StageSpec>;

export const INTERVIEW_MIN_SEC = 30 * 60;
export const INTERVIEW_MAX_SEC = 40 * 60;

export const ModeSpec = z
  .object({
    stages: z.array(StageSpec).min(1).max(20),
    adaptivity: z
      .object({ difficultyStep: z.int().min(0).max(2), minScoreToRaise: z.number().min(0).max(1) })
      .optional(),
  })
  .refine((s) => new Set(s.stages.map((x) => x.id)).size === s.stages.length, 'stage ids must be unique');

export type ModeSpec = z.infer<typeof ModeSpec>;

/** Product rule for published modes: every stage is timed and the total is 30 to 40 minutes. Test fixtures may differ. */
export function interviewDurationOk(s: ModeSpec): boolean {
  const total = s.stages.reduce((n, x) => n + (x.timeLimitSec ?? 0), 0);
  return s.stages.every((x) => x.timeLimitSec) && total >= INTERVIEW_MIN_SEC && total <= INTERVIEW_MAX_SEC;
}

export const ExecLimits = z.object({
  cpuMs: z.int().min(100).max(60_000),
  wallMs: z.int().min(100).max(120_000),
  memoryMb: z.int().min(16).max(4096),
  pids: z.int().min(1).max(256),
  outputBytes: z.int().min(1024).max(1_048_576),
});
export type ExecLimits = z.infer<typeof ExecLimits>;

export const TestCase = z.object({
  name: z.string().min(1).max(100),
  input: z.string().max(10_000),
  expected: z.string().max(10_000),
  /** Relative weight in the test score. */
  weight: z.number().gt(0).max(100).default(1),
  /** Per-case wall-time override. */
  timeLimitMs: z.int().min(100).max(60_000).optional(),
});
export type TestCase = z.infer<typeof TestCase>;

/**
 * question_templates.body as authored. A coding problem is a template of kind `coding`.
 * tests.visible are the sample cases shown to the candidate; tests.hidden never leave the server.
 */
export const QuestionBody = z.object({
  title: z.string().max(200).optional(),
  prompt: z.string().min(1).max(20_000),
  exhibits: z.array(z.object({ title: z.string().max(200), body: z.string().max(20_000) })).max(10).optional(),
  /** Keyed by language slug. */
  starterCode: z.record(z.string(), z.string().max(20_000)).optional(),
  tests: z.object({ visible: z.array(TestCase).max(20), hidden: z.array(TestCase).max(100) }).optional(),
  /** Per-language execution limit overrides, keyed by language slug, merged over languages.limits. */
  limits: z.record(z.string(), ExecLimits.partial()).optional(),
  /** addition: language slugs this problem accepts. Omitted means every enabled language. */
  languages: z.array(Slug).min(1).max(20).optional(),
});
export type QuestionBody = z.infer<typeof QuestionBody>;

export const SampleTest = z.object({ name: z.string(), input: z.string(), expected: z.string() });
export type SampleTest = z.infer<typeof SampleTest>;

/** What the candidate sees: the body without hidden tests, weights or limits. */
export const QuestionView = z.object({
  title: z.string().optional(),
  prompt: z.string(),
  exhibits: z.array(z.object({ title: z.string(), body: z.string() })).optional(),
  starterCode: z.record(z.string(), z.string()).optional(),
  visibleTests: z.array(SampleTest).optional(),
});
export type QuestionView = z.infer<typeof QuestionView>;

export const CandidateContent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().min(1).max(20_000) }),
  z.object({ type: z.literal('code'), submissionId: z.uuid() }),
  z.object({
    type: z.literal('structured'),
    fields: z.record(z.string().max(100), z.union([z.string().max(5_000), z.number()])),
  }),
]);
export type CandidateContent = z.infer<typeof CandidateContent>;

export const InterviewerContent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('question'), question: QuestionView }),
  z.object({ type: z.literal('follow_up'), text: z.string() }),
]);
export type InterviewerContent = z.infer<typeof InterviewerContent>;

/** The closed set of answer shapes each interaction kind accepts. Keyed on kind, never on domain. */
export const KIND_CONTENT: Record<StageKind, readonly CandidateContent['type'][]> = {
  conversation: ['text'],
  coding: ['code', 'text'],
  case: ['text', 'structured'],
  quant: ['text', 'structured'],
  document: ['text'],
  whiteboard: ['text', 'structured'],
};

export const RubricLevel = z.object({ score: z.int().min(0).max(10), descriptor: z.string().min(1).max(1000) });
export type RubricLevel = z.infer<typeof RubricLevel>;
