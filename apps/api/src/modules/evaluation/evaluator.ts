import { z } from 'zod';
import type { StageKind } from '@ai-interview/shared';
import { AiFailure, type AiContext, type TaskDef, type TaskRunner } from '../../ai/runner';
import { isVerbatim } from '../../ai/untrusted';
import type { RubricCriterion } from '../catalog/catalog';

/**
 * EVALUATOR role. Sees the question, the answer, the rubric and test results. Never talks to the
 * candidate. Models propose per-criterion levels with quotes; code validates every value and the
 * stage score is arithmetic over the validated levels.
 */

export interface StageEvidence {
  kind: StageKind;
  question: string;
  /** Candidate answers in this stage, oldest first. */
  answers: string[];
  /** Deterministic summary of graded test results, or null when the stage had none. */
  testSummary: string | null;
  /** Sanitized program output; untrusted. */
  testOutput: string | null;
}

export interface CriterionResult {
  criterionId: string;
  competencyId: string;
  name: string;
  weight: number;
  /** Normalized to 0..1 over the criterion's level range. */
  score: number;
  confidence: number;
  rationale: string;
  evidence: string[];
  disagreement: boolean;
}

export interface StageEvaluation {
  status: 'scored' | 'failed';
  score: number | null;
  lowConfidence: boolean;
  criteria: CriterionResult[];
  model: string;
  promptVersion: string;
}

// ---------- tasks ----------

interface AnalyzeInput {
  kind: StageKind;
  question: string;
  answer: string;
}
const Observations = z.object({
  observations: z.array(z.object({ quote: z.string().min(1).max(500), note: z.string().min(1).max(500) })).max(12),
});

const analyzeAnswerTask: TaskDef<AnalyzeInput, z.infer<typeof Observations>> = {
  role: 'evaluator',
  task: 'analyzeAnswer',
  promptRef: () => 'evaluator/analyze-answer.v1',
  tier: 'primary',
  effort: 'low',
  maxTokens: 3000,
  vars: (i) => ({ kind: i.kind }),
  data: (i) => ({ question: i.question, answer: i.answer }),
  maxDataChars: 30_000,
  output: () => Observations,
};

interface ScoreInput extends StageEvidence {
  criteria: RubricCriterion[];
  observations: string;
}

const levelsOf = (c: RubricCriterion) => c.levels.map((l) => l.score).sort((a, b) => a - b);

function scoreSchema(i: ScoreInput) {
  const ids = i.criteria.map((c) => c.id) as [string, ...string[]];
  return z.object({
    criteria: z
      .array(
        z.object({
          criterionId: z.enum(ids),
          level: z.int(),
          rationale: z.string().min(1).max(1000),
          evidence: z.array(z.string().min(1).max(500)).max(5),
        }),
      )
      .length(ids.length),
  });
}
type ScoreOutput = z.infer<ReturnType<typeof scoreSchema>>;

/** Each criterion exactly once, and each level one the rubric defines. */
function checkScores(out: ScoreOutput, i: ScoreInput): string | null {
  const seen = new Set<string>();
  for (const c of out.criteria) {
    if (seen.has(c.criterionId)) return `criterion ${c.criterionId} scored twice`;
    seen.add(c.criterionId);
    const allowed = levelsOf(i.criteria.find((x) => x.id === c.criterionId)!);
    if (!allowed.includes(c.level)) return `level ${c.level} for ${c.criterionId} is not one of ${allowed.join(', ')}`;
  }
  return null;
}

const rubricText = (criteria: RubricCriterion[]) =>
  criteria
    .map((c) => `- id: ${c.id}\n  name: ${c.name}\n  levels:\n${c.levels.map((l) => `    ${l.score}: ${l.descriptor}`).join('\n')}`)
    .join('\n');

const scoreTask = (task: 'scoreStage' | 'reviewStage'): TaskDef<ScoreInput, ScoreOutput> => ({
  role: 'evaluator',
  task,
  promptRef: () => (task === 'scoreStage' ? 'evaluator/score-stage.v1' : 'evaluator/review-stage.v1'),
  tier: task === 'scoreStage' ? 'primary' : 'review',
  effort: 'medium',
  maxTokens: 4000,
  vars: (i) => ({ kind: i.kind, rubric: rubricText(i.criteria), test_summary: i.testSummary ?? 'No test results for this stage.' }),
  data: (i) => ({
    question: i.question,
    answers: i.answers.map((a, n) => `Answer ${n + 1}:\n${a}`).join('\n\n'),
    ...(i.testOutput ? { program_output: i.testOutput } : {}),
    ...(task === 'scoreStage' && i.observations ? { analyst_notes: i.observations } : {}),
  }),
  maxDataChars: 40_000,
  output: scoreSchema,
  check: checkScores,
});

interface SummaryInput {
  overallPercent: number | null;
  competencies: { name: string; percent: number }[];
  strengths: string[];
  gaps: string[];
}
const Summary = z.object({ headline: z.string().min(1).max(200), narrative: z.string().min(1).max(3000) });

const summarizeReportTask: TaskDef<SummaryInput, z.infer<typeof Summary>> = {
  role: 'evaluator',
  task: 'summarizeReport',
  promptRef: () => 'evaluator/summarize-report.v1',
  tier: 'primary',
  effort: 'low',
  maxTokens: 2000,
  vars: (i) => ({
    overall: i.overallPercent === null ? 'not scored' : `${i.overallPercent}%`,
    competencies: i.competencies.map((c) => `- ${c.name}: ${c.percent}%`).join('\n') || '- none',
    strengths: i.strengths.join(', ') || 'none',
    gaps: i.gaps.join(', ') || 'none',
  }),
  data: () => ({}),
  maxDataChars: 1,
  output: () => Summary,
  // The narrative may describe scores but never state numbers, so it cannot contradict or invent them.
  check: (o) => (/\d/.test(o.headline + o.narrative) ? 'the text must not contain digits' : null),
};

// ---------- deterministic parts ----------

const SINGLE_PASS_CONFIDENCE = 0.6;
const AGREED_CONFIDENCE = 0.85;
const DISAGREED_CONFIDENCE = 0.3;
const UNSUPPORTED_CONFIDENCE = 0.3;

export function normalizeLevel(c: RubricCriterion, level: number): number {
  const ls = levelsOf(c);
  const lo = ls[0]!;
  const hi = ls[ls.length - 1]!;
  return hi === lo ? 1 : (level - lo) / (hi - lo);
}

/** Pure: validated pass outputs -> criterion results and stage score. */
export function combinePasses(
  criteria: RubricCriterion[],
  primary: ScoreOutput,
  review: ScoreOutput | null,
  evidenceSources: string[],
  disagreementThreshold: number,
): { score: number; lowConfidence: boolean; criteria: CriterionResult[] } {
  let low = false;
  const results = criteria.map((c): CriterionResult => {
    const p = primary.criteria.find((x) => x.criterionId === c.id)!;
    const r = review?.criteria.find((x) => x.criterionId === c.id);
    const ps = normalizeLevel(c, p.level);
    let score = ps;
    let confidence = SINGLE_PASS_CONFIDENCE;
    let disagreement = false;
    if (r) {
      const rs = normalizeLevel(c, r.level);
      if (Math.abs(ps - rs) > disagreementThreshold) {
        // Not averaged: keep the primary score and say plainly it is uncertain.
        disagreement = true;
        confidence = DISAGREED_CONFIDENCE;
      } else {
        score = (ps + rs) / 2;
        confidence = AGREED_CONFIDENCE;
      }
    }
    const quotes = [...p.evidence, ...(r?.evidence ?? [])];
    const valid = quotes.filter((q) => isVerbatim(q, evidenceSources));
    // Dedupe only for storage: both passes citing the same quote is agreement, not a dropped quote.
    const kept = [...new Set(valid)];
    if (kept.length === 0) confidence = Math.min(confidence, UNSUPPORTED_CONFIDENCE);
    else if (valid.length < quotes.length) confidence *= Math.max(0.5, valid.length / quotes.length);
    if (disagreement || kept.length === 0) low = true;
    return { criterionId: c.id, competencyId: c.competencyId, name: c.name, weight: c.weight, score, confidence, rationale: p.rationale, evidence: kept, disagreement };
  });
  const wsum = results.reduce((s, x) => s + x.weight, 0);
  return { score: results.reduce((s, x) => s + x.weight * x.score, 0) / wsum, lowConfidence: low, criteria: results };
}

export function createEvaluator(run: TaskRunner, opts: { disagreementThreshold: number }) {
  return {
    /**
     * Applies a rubric to one stage. withReview adds an independent second pass (different prompt and
     * model). Any rejected or unavailable model output yields status 'failed' with a null score.
     */
    async evaluateStage(ctx: AiContext, evidence: StageEvidence, criteria: RubricCriterion[], withReview: boolean): Promise<StageEvaluation> {
      const sources = [...evidence.answers, ...(evidence.testOutput ? [evidence.testOutput] : [])];
      try {
        const notes: string[] = [];
        for (const answer of evidence.answers) {
          const a = await run(analyzeAnswerTask, { kind: evidence.kind, question: evidence.question, answer }, ctx);
          for (const o of a.output.observations) if (isVerbatim(o.quote, [answer])) notes.push(`"${o.quote}": ${o.note}`);
        }
        const input: ScoreInput = { ...evidence, criteria, observations: notes.join('\n') };
        const primary = await run(scoreTask('scoreStage'), input, ctx);
        const review = withReview ? await run(scoreTask('reviewStage'), input, ctx) : null;
        const combined = combinePasses(criteria, primary.output, review?.output ?? null, sources, opts.disagreementThreshold);
        return { status: 'scored', ...combined, model: review ? `${primary.model}+${review.model}` : primary.model, promptVersion: primary.promptVersion };
      } catch (err) {
        if (!(err instanceof AiFailure)) throw err;
        return { status: 'failed', score: null, lowConfidence: true, criteria: [], model: 'none', promptVersion: 'evaluator/score-stage.v1' };
      }
    },

    async summarize(ctx: AiContext, input: SummaryInput): Promise<{ headline: string; narrative: string } | null> {
      try {
        return (await run(summarizeReportTask, input, ctx)).output;
      } catch (err) {
        if (err instanceof AiFailure) return null;
        throw err;
      }
    },
  };
}
export type Evaluator = ReturnType<typeof createEvaluator>;
