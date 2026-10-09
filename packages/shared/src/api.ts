import { z } from 'zod';
import {
  ErrorCode,
  EvaluationStatus,
  ReadinessStream,
  ResumeContentType,
  ResumeStatus,
  RunJobStatus,
  RunStatus,
  RunSuite,
  SessionStatus,
  StageKind,
  StageRunStatus,
  TurnActor,
  UserRole,
} from './enums';
import {
  CandidateContent,
  InterviewerContent,
  ModeSpec,
  QuestionBody,
  QuestionView,
  RubricLevel,
  Slug,
  Difficulty,
  VersionedRef,
} from './spec';

const Id = z.uuid();
const Timestamp = z.iso.datetime({ offset: true });
const Score = z.number().min(0).max(1);
const list = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });

/** Header carried by retryable creates (POST /sessions, /resumes, /stage-runs/{id}/submissions, /packs). */
export const IDEMPOTENCY_HEADER = 'idempotency-key';

// ---------- errors (RFC 7807) ----------
export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.int(),
  code: ErrorCode,
  detail: z.string().optional(),
  instance: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  /** Present on seq_conflict: the seq the server expects next. */
  expectedSeq: z.int().optional(),
});
export type Problem = z.infer<typeof Problem>;

// ---------- common params ----------
export const IdParams = z.object({ id: Id });
export type IdParams = z.infer<typeof IdParams>;

// ---------- identity ----------
export const Me = z.object({
  id: Id,
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  locale: z.string().nullable(),
  roles: z.array(UserRole),
});
export type Me = z.infer<typeof Me>;

// ---------- catalog ----------
export const Domain = z.object({ id: Id, slug: z.string(), name: z.string() });
export type Domain = z.infer<typeof Domain>;
export const DomainList = list(Domain);
export type DomainList = z.infer<typeof DomainList>;

export const CareerRole = z.object({ id: Id, domainId: Id, slug: z.string(), name: z.string() });
export type CareerRole = z.infer<typeof CareerRole>;
export const CareerRoleList = list(CareerRole);
export type CareerRoleList = z.infer<typeof CareerRoleList>;

export const ModeSummary = z.object({
  id: Id,
  slug: z.string(),
  name: z.string(),
  stageKinds: z.array(StageKind),
  latestVersion: z.int(),
});
export type ModeSummary = z.infer<typeof ModeSummary>;
export const ModeList = list(ModeSummary);
export type ModeList = z.infer<typeof ModeList>;

export const ModeDetail = z.object({
  id: Id,
  slug: z.string(),
  name: z.string(),
  domainId: Id,
  versionId: Id,
  version: z.int(),
  spec: ModeSpec,
  publishedAt: Timestamp,
});
export type ModeDetail = z.infer<typeof ModeDetail>;

export const Language = z.object({ id: Id, slug: z.string() });
export type Language = z.infer<typeof Language>;
export const LanguageList = list(Language);
export type LanguageList = z.infer<typeof LanguageList>;

// ---------- authoring ----------
export const CreatePackRequest = z.object({ domainId: Id, slug: Slug, name: z.string().min(1).max(200) });
export type CreatePackRequest = z.infer<typeof CreatePackRequest>;
export const Pack = z.object({ id: Id, domainId: Id, slug: z.string(), name: z.string() });
export type Pack = z.infer<typeof Pack>;

export const PackContent = z.object({
  competencies: z
    .array(z.object({ slug: Slug, name: z.string().min(1), description: z.string().default(''), parentSlug: Slug.optional() }))
    .min(1),
  rubrics: z
    .array(
      z.object({
        slug: Slug,
        version: z.int().min(1),
        criteria: z
          .array(
            z.object({
              competencySlug: Slug,
              name: z.string().min(1),
              weight: z.number().gt(0),
              levels: z.array(RubricLevel).min(2),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
  questionTemplates: z.array(
    z.object({
      kind: StageKind,
      tags: z.array(z.string().min(1)).min(1),
      difficulty: Difficulty,
      body: QuestionBody,
      rubricRef: VersionedRef.optional(),
    }),
  ),
  modes: z.array(z.object({ slug: Slug, name: z.string().min(1), spec: ModeSpec })),
});
export type PackContent = z.infer<typeof PackContent>;

export const CreatePackVersionRequest = z.object({ version: z.int().min(1), content: PackContent });
export type CreatePackVersionRequest = z.infer<typeof CreatePackVersionRequest>;

export const PackVersion = z.object({
  id: Id,
  packId: Id,
  version: z.int(),
  publishedAt: Timestamp.nullable(),
  contentHash: z.string().nullable(),
});
export type PackVersion = z.infer<typeof PackVersion>;

// ---------- resume and profile ----------
export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

export const CreateResumeRequest = z.object({
  fileName: z.string().min(1).max(255),
  contentType: ResumeContentType,
  sizeBytes: z.int().min(1).max(MAX_RESUME_BYTES),
});
export type CreateResumeRequest = z.infer<typeof CreateResumeRequest>;

export const CreateResumeResponse = z.object({
  resumeId: Id,
  uploadUrl: z.url(),
  /** Send these headers with the PUT to uploadUrl. */
  uploadHeaders: z.record(z.string(), z.string()),
  expiresAt: Timestamp,
});
export type CreateResumeResponse = z.infer<typeof CreateResumeResponse>;

export const Resume = z.object({
  id: Id,
  status: ResumeStatus,
  fileName: z.string(),
  createdAt: Timestamp,
  parsedAt: Timestamp.nullable(),
  error: z.string().nullable(),
});
export type Resume = z.infer<typeof Resume>;

export const ProfileSkill = z.object({
  skillId: Id.nullable(),
  name: z.string(),
  claimedLevel: z.int().min(1).max(5).nullable(),
  source: z.enum(['resume', 'manual']),
  evidence: z.array(z.string()),
});
export type ProfileSkill = z.infer<typeof ProfileSkill>;

export const Experience = z.object({
  org: z.string(),
  title: z.string(),
  start: z.string().nullable(),
  end: z.string().nullable(),
  description: z.string().nullable(),
});
export type Experience = z.infer<typeof Experience>;

export const Education = z.object({
  institution: z.string(),
  degree: z.string().nullable(),
  field: z.string().nullable(),
  start: z.string().nullable(),
  end: z.string().nullable(),
});
export type Education = z.infer<typeof Education>;

export const Profile = z.object({
  id: Id,
  headline: z.string().nullable(),
  summary: z.string().nullable(),
  sourceResumeId: Id.nullable(),
  experiences: z.array(Experience),
  education: z.array(Education),
  skills: z.array(ProfileSkill),
});
export type Profile = z.infer<typeof Profile>;

export const PatchProfileRequest = z
  .object({ headline: z.string().max(300).nullable(), summary: z.string().max(5000).nullable() })
  .partial()
  .refine((p) => Object.keys(p).length > 0, 'at least one field');
export type PatchProfileRequest = z.infer<typeof PatchProfileRequest>;

export const ReadinessItem = z.object({
  competencyId: Id,
  competencySlug: z.string(),
  competencyName: z.string(),
  score: Score,
  confidence: Score,
  streams: z.array(ReadinessStream),
  updatedAt: Timestamp,
});
export type ReadinessItem = z.infer<typeof ReadinessItem>;
export const ReadinessList = list(ReadinessItem);
export type ReadinessList = z.infer<typeof ReadinessList>;

// ---------- interview ----------
export const CreateSessionRequest = z.object({ modeId: Id, targetRoleId: Id.optional() });
export type CreateSessionRequest = z.infer<typeof CreateSessionRequest>;

export const StageRun = z.object({
  id: Id,
  stageId: z.string(),
  kind: StageKind,
  idx: z.int(),
  status: StageRunStatus,
  timeLimitSec: z.int().nullable(),
  startedAt: Timestamp.nullable(),
  /** Server-authoritative: startedAt + timeLimitSec. Submissions and runs are refused after it (plus a short grace). */
  deadlineAt: Timestamp.nullable(),
  endedAt: Timestamp.nullable(),
});
export type StageRun = z.infer<typeof StageRun>;

export const Session = z.object({
  id: Id,
  status: SessionStatus,
  modeId: Id,
  modeVersionId: Id,
  modeName: z.string(),
  targetRoleId: Id.nullable(),
  currentStageIdx: z.int().nullable(),
  stages: z.array(StageRun),
  startedAt: Timestamp.nullable(),
  endedAt: Timestamp.nullable(),
  createdAt: Timestamp,
});
export type Session = z.infer<typeof Session>;

export const Turn = z.object({
  seq: z.int(),
  stageIdx: z.int(),
  actor: TurnActor,
  content: z.union([CandidateContent, InterviewerContent]),
  createdAt: Timestamp,
});
export type Turn = z.infer<typeof Turn>;

export const SessionState = z.object({
  sessionId: Id,
  status: SessionStatus,
  currentStage: StageRun.nullable(),
  question: QuestionView.nullable(),
  /** Turns of the current stage, oldest first. */
  turns: z.array(Turn),
  /** The seq the next candidate turn must carry. */
  nextSeq: z.int(),
  /** Seconds left in the current stage by the server clock; null when the stage has no time limit. */
  remainingSec: z.int().nullable(),
  serverTime: Timestamp,
});
export type SessionState = z.infer<typeof SessionState>;

export const SubmitTurnRequest = z.object({ seq: z.int().min(1), content: CandidateContent });
export type SubmitTurnRequest = z.infer<typeof SubmitTurnRequest>;

export const SubmitTurnResponse = z.object({
  candidateTurn: Turn,
  /** The interviewer's reply (follow-up or next question); null when the session completed. */
  interviewerTurn: Turn.nullable(),
  state: SessionState,
  /** True when this response replays a previously stored result for the same seq. */
  replayed: z.boolean(),
});
export type SubmitTurnResponse = z.infer<typeof SubmitTurnResponse>;

/** SSE event names on GET /sessions/{id}/events. `id:` is the turn seq for question events. */
export const SseEvent = z.discriminatedUnion('event', [
  z.object({ event: z.literal('question'), data: z.object({ turn: Turn }) }),
  z.object({ event: z.literal('token'), data: z.object({ seq: z.int(), delta: z.string() }) }),
  z.object({ event: z.literal('stage_change'), data: z.object({ stageIdx: z.int(), stageId: z.string(), kind: StageKind }) }),
  z.object({ event: z.literal('done'), data: z.object({ status: SessionStatus }) }),
]);
export type SseEvent = z.infer<typeof SseEvent>;

// ---------- coding ----------
export const MAX_SOURCE_BYTES = 64 * 1024;

export const CreateSubmissionRequest = z.object({
  languageId: Id,
  source: z.string().min(1).refine((s) => new TextEncoder().encode(s).length <= MAX_SOURCE_BYTES, 'source too large'),
  /** Optional approach notes, stored with the (immutable) submission. */
  explanation: z.string().max(5000).optional(),
});
export type CreateSubmissionRequest = z.infer<typeof CreateSubmissionRequest>;

export const Submission = z.object({
  id: Id,
  stageRunId: Id,
  languageId: Id,
  source: z.string(),
  explanation: z.string().nullable(),
  createdAt: Timestamp,
});
export type Submission = z.infer<typeof Submission>;
export const SubmissionList = list(Submission);
export type SubmissionList = z.infer<typeof SubmissionList>;

export const RunJob = z.object({ jobId: Id, submissionId: Id, suite: RunSuite, status: RunJobStatus });
export type RunJob = z.infer<typeof RunJob>;

export const PerTestResult = z.object({ name: z.string(), passed: z.boolean(), timeMs: z.number(), memKb: z.number() });
export type PerTestResult = z.infer<typeof PerTestResult>;

export const SubmissionResult = z.object({
  submissionId: Id,
  /** The latest run of this submission (a visible run, or the graded full run after a code turn). */
  suite: RunSuite.nullable(),
  jobStatus: RunJobStatus.nullable(),
  result: z
    .object({
      status: RunStatus,
      /** Sample (visible) tests only. Hidden tests appear only as counts. */
      perTest: z.array(PerTestResult),
      hiddenPassed: z.int().nullable(),
      hiddenTotal: z.int().nullable(),
      stdout: z.string(),
      stderr: z.string(),
    })
    .nullable(),
});
export type SubmissionResult = z.infer<typeof SubmissionResult>;

// ---------- evaluation and reports ----------
export const Pending = z.object({ status: z.literal('pending') });
export type Pending = z.infer<typeof Pending>;

export const CompetencyScore = z.object({
  competencyId: Id,
  slug: z.string(),
  name: z.string(),
  score: Score,
  confidence: Score,
  evidence: z.array(z.object({ quote: z.string(), stageId: z.string(), criterion: z.string() })),
});
export type CompetencyScore = z.infer<typeof CompetencyScore>;

export const StageScore = z.object({
  stageId: z.string(),
  kind: StageKind,
  weight: z.number(),
  /** null when the stage was not scored (status failed or skipped); never a made-up value. */
  score: Score.nullable(),
  status: z.enum(['scored', 'failed', 'skipped']),
  /** The two evaluator passes disagreed, or quoted evidence failed verification. */
  lowConfidence: z.boolean(),
});
export type StageScore = z.infer<typeof StageScore>;

export const Evaluation = z.object({
  id: Id,
  sessionId: Id,
  status: EvaluationStatus,
  /** Deterministic weighted aggregate of scored stages. */
  overall: Score.nullable(),
  lowConfidence: z.boolean(),
  model: z.string().nullable(),
  promptVersion: z.string().nullable(),
  competencies: z.array(CompetencyScore),
  stages: z.array(StageScore),
});
export type Evaluation = z.infer<typeof Evaluation>;

export const ReportBody = z.object({
  overall: Score.nullable(),
  lowConfidence: z.boolean(),
  headline: z.string(),
  narrative: z.string(),
  competencies: z.array(CompetencyScore),
  stages: z.array(StageScore),
  strengths: z.array(z.object({ competencyId: Id, name: z.string(), score: Score })),
  gaps: z.array(z.object({ competencyId: Id, name: z.string(), score: Score })),
  trend: z.array(z.object({ sessionId: Id, overall: Score, finishedAt: Timestamp })),
  nextPractice: z.object({ modeId: Id, name: z.string() }).nullable(),
});
export type ReportBody = z.infer<typeof ReportBody>;

export const Report = z.object({ id: Id, evaluationId: Id, sessionId: Id, body: ReportBody, renderedAt: Timestamp });
export type Report = z.infer<typeof Report>;

// ---------- careers ----------
export const CompetencyGap = z.object({
  competencyId: Id,
  name: z.string(),
  required: Score,
  current: Score,
  weight: z.number(),
});
export type CompetencyGap = z.infer<typeof CompetencyGap>;

export const RoleFit = z.object({
  roleId: Id,
  name: z.string(),
  domainId: Id,
  fit: Score,
  gaps: z.array(CompetencyGap),
  explanation: z.string().nullable(),
});
export type RoleFit = z.infer<typeof RoleFit>;

export const LearningResource = z.object({
  id: Id,
  title: z.string(),
  url: z.string(),
  skillName: z.string(),
  level: z.int(),
  /** LLM-phrased; null when no explanation was generated. */
  reason: z.string().nullable(),
});
export type LearningResource = z.infer<typeof LearningResource>;

export const Recommendations = z.object({
  generatedAt: Timestamp.nullable(),
  /** Domains ranked by confidence-weighted readiness. Arithmetic, not an LLM guess. */
  domains: z.array(z.object({ domainId: Id, name: z.string(), strength: Score })),
  roles: z.array(RoleFit),
  gaps: z.array(CompetencyGap),
  learningPath: z.array(LearningResource),
  nextMode: z.object({ modeId: Id, name: z.string() }).nullable(),
});
export type Recommendations = z.infer<typeof Recommendations>;

// ---------- history ----------
export const HistoryQuery = z.object({
  domain: Id.optional(),
  mode: Slug.optional(),
  from: Timestamp.optional(),
  to: Timestamp.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type HistoryQuery = z.infer<typeof HistoryQuery>;

export const SessionSummary = z.object({
  sessionId: Id,
  domainId: Id,
  modeSlug: z.string(),
  overall: Score.nullable(),
  finishedAt: Timestamp,
  topGaps: z.array(z.object({ competencyId: Id, name: z.string(), score: Score })),
});
export type SessionSummary = z.infer<typeof SessionSummary>;
export const HistoryList = list(SessionSummary);
export type HistoryList = z.infer<typeof HistoryList>;

export const TrendsQuery = z.object({ competency: Id.optional() });
export type TrendsQuery = z.infer<typeof TrendsQuery>;

export const Trends = z.object({
  competencyId: Id.nullable(),
  points: z.array(z.object({ sessionId: Id, score: Score, finishedAt: Timestamp })),
});
export type Trends = z.infer<typeof Trends>;

// ---------- analytics ----------
export const MyAnalytics = z.object({
  sessionsStarted: z.int(),
  sessionsCompleted: z.int(),
  averageOverall: Score.nullable(),
  eventCounts: z.record(z.string(), z.int()),
  lastActiveAt: Timestamp.nullable(),
});
export type MyAnalytics = z.infer<typeof MyAnalytics>;

export const QuestionStats = z.object({
  questionTemplateId: Id,
  kind: StageKind,
  difficulty: z.int(),
  timesAsked: z.int(),
  averageScore: Score.nullable(),
  /** Correlation between the stage score on this question and the session overall. */
  discrimination: z.number().min(-1).max(1).nullable(),
});
export type QuestionStats = z.infer<typeof QuestionStats>;
export const QuestionStatsList = list(QuestionStats);
export type QuestionStatsList = z.infer<typeof QuestionStatsList>;
