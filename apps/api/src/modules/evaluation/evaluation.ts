import {
  CandidateContent,
  IdParams,
  InterviewerContent,
  type CompetencyScore,
  type Evaluation,
  type Pending,
  type ReportBody,
  type StageKind,
  type StageScore,
} from '@ai-interview/shared';
import type { Db, Sql } from '../../db/db';
import { notFound } from '../../http/errors';
import { reportForSession, saveReport } from '../reports/reports';
import type { Route } from '../../http/route';
import { enqueue, RetryLater } from '../../queue/queue';
import { track } from '../analytics/analytics';
import { recordEvidence } from '../candidate/readiness';
import { nextMode } from '../careers/careers';
import { getModeVersion, resolveRubric } from '../catalog/catalog';
import { priorInDomain, upsertSummary } from '../history/history';
import { candidateView } from '../sandbox/sandbox';
import { aggregate, type StageForAggregate } from './aggregate';
import type { CriterionResult, Evaluator, StageEvidence } from './evaluator';

async function ensureEvaluation(sql: Sql, sessionId: string, userId: string): Promise<string> {
  const [row] = await sql.query<{ id: string }>(
    `insert into evaluations (session_id, user_id) values ($1, $2) on conflict (session_id) do update set session_id = excluded.session_id returning id`,
    [sessionId, userId],
  );
  return row!.id;
}

/** Gathers what the evaluator may see for one stage. Returns null while a graded run is still pending. */
async function stageEvidence(sql: Sql, stageRunId: string, kind: StageKind, waitMs: number): Promise<StageEvidence | null> {
  const turns = await sql.query<{ actor: string; content: unknown }>('select actor, content from turns where stage_run_id = $1 order by seq', [stageRunId]);
  let question = '';
  const answers: string[] = [];
  let testSummary: string | null = null;
  let testOutput: string | null = null;
  for (const t of turns) {
    if (t.actor === 'interviewer') {
      const c = InterviewerContent.parse(t.content);
      if (c.type === 'question') question = c.question.prompt;
      continue;
    }
    const c = CandidateContent.parse(t.content);
    if (c.type === 'text') answers.push(c.text);
    else if (c.type === 'structured') answers.push(Object.entries(c.fields).map(([k, v]) => `${k}: ${v}`).join('\n'));
    else {
      const [sub] = await sql.query<{ source: string; explanation: string | null }>('select source, explanation from code_submissions where id = $1', [c.submissionId]);
      answers.push(`${sub?.explanation ? `Approach: ${sub.explanation}\n\n` : ''}${sub?.source ?? ''}`);
      const [job] = await sql.query<{ id: string; status: string; created_at: Date }>(
        `select id, status, created_at from run_jobs where submission_id = $1 and suite = 'full'`,
        [c.submissionId],
      );
      if (job && (job.status === 'queued' || job.status === 'leased') && Date.now() - new Date(job.created_at).getTime() < waitMs) return null;
      const [res] = job
        ? await sql.query<{ status: never; per_test: never; stdout: string; stderr: string }>('select status, per_test, stdout, stderr from run_results where job_id = $1', [job.id])
        : [];
      if (res) {
        const v = candidateView(res);
        testSummary = `Graded run status: ${v.status}. Sample tests passed: ${v.perTest.filter((p) => p.passed).length} of ${v.perTest.length}. Hidden tests passed: ${v.hiddenPassed ?? 0} of ${v.hiddenTotal ?? 0}.`;
        testOutput = [v.stdout, v.stderr].filter(Boolean).join('\n') || null;
      } else {
        testSummary = 'The graded run produced no result.';
      }
    }
  }
  return { kind, question, answers, testSummary, testOutput };
}

export function createEvaluationJobs(deps: { db: Db; evaluator: Evaluator; reviewMinWeight: number; runWaitMs: number }) {
  const { db, evaluator, reviewMinWeight, runWaitMs } = deps;

  async function evaluateStage({ stageRunId }: { stageRunId: string }) {
    const ctx = await db.tx(async (sql) => {
      const [sr] = await sql.query<{ id: string; session_id: string; user_id: string; idx: number; kind: StageKind; mode_version_id: string }>(
        `select sr.id, sr.session_id, sr.user_id, sr.idx, sr.kind, s.mode_version_id from stage_runs sr join sessions s on s.id = sr.session_id where sr.id = $1`,
        [stageRunId],
      );
      if (!sr) return null;
      const [done] = await sql.query('select 1 from stage_evaluations where stage_run_id = $1', [stageRunId]);
      if (done) return null;
      const mv = await getModeVersion(sql, sr.mode_version_id);
      const stage = mv.spec.stages[sr.idx]!;
      const rubric = await resolveRubric(sql, mv.packVersionId, stage.rubricRef);
      const evidence = await stageEvidence(sql, stageRunId, sr.kind, runWaitMs);
      const evaluationId = await ensureEvaluation(sql, sr.session_id, sr.user_id);
      return { sr, stage, rubric, evidence, evaluationId };
    });
    if (!ctx) return;
    if (!ctx.evidence) throw new RetryLater(10_000, 'waiting for graded run');
    const result = await evaluator.evaluateStage({ userId: ctx.sr.user_id }, ctx.evidence, ctx.rubric.criteria, ctx.stage.weight >= reviewMinWeight);
    await db.query(
      `insert into stage_evaluations (stage_run_id, evaluation_id, user_id, status, score, low_confidence, criteria, model, prompt_version)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) on conflict (stage_run_id) do nothing`,
      [stageRunId, ctx.evaluationId, ctx.sr.user_id, result.status, result.score, result.lowConfidence, JSON.stringify(result.criteria), result.model, result.promptVersion],
    );
  }

  async function finalizeEvaluation({ sessionId }: { sessionId: string }) {
    const plan = await db.tx(async (sql) => {
      const [s] = await sql.query<{ user_id: string; mode_version_id: string; ended_at: Date }>('select user_id, mode_version_id, ended_at from sessions where id = $1', [sessionId]);
      if (!s) return null;
      const evaluationId = await ensureEvaluation(sql, sessionId, s.user_id);
      const [ev] = await sql.query<{ status: string }>('select status from evaluations where id = $1', [evaluationId]);
      if (ev?.status === 'ready') return null;
      const runs = await sql.query<{ id: string; idx: number; stage_id: string; kind: StageKind; status: string; se_status: 'scored' | 'failed' | null; score: number | null; low_confidence: boolean | null; criteria: CriterionResult[] | null; model: string | null; prompt_version: string | null }>(
        `select sr.id, sr.idx, sr.stage_id, sr.kind, sr.status, se.status as se_status, se.score, se.low_confidence, se.criteria, se.model, se.prompt_version
         from stage_runs sr left join stage_evaluations se on se.stage_run_id = sr.id where sr.session_id = $1 order by sr.idx`,
        [sessionId],
      );
      if (runs.some((r) => r.status === 'completed' && !r.se_status)) return 'wait' as const;
      const mv = await getModeVersion(sql, s.mode_version_id);
      const stages: StageForAggregate[] = runs.map((r) => ({
        stageId: r.stage_id, kind: r.kind, weight: mv.spec.stages[r.idx]!.weight,
        status: r.se_status ?? 'skipped', score: r.score, lowConfidence: r.low_confidence ?? false, criteria: r.criteria ?? [],
      }));
      const agg = aggregate(stages);
      const comps = await sql.query<{ id: string; slug: string; name: string }>('select id, slug, name from competencies where id = any($1::uuid[])', [agg.competencies.map((c) => c.competencyId)]);
      const byId = new Map(comps.map((c) => [c.id, c]));
      const competencies: CompetencyScore[] = agg.competencies
        .map((c) => ({ ...c, slug: byId.get(c.competencyId)!.slug, name: byId.get(c.competencyId)!.name }))
        .sort((a, b) => b.score - a.score);
      const ranked = competencies.map((c) => ({ competencyId: c.competencyId, name: c.name, score: c.score }));
      const strengths = ranked.filter((c) => c.score >= 0.7).slice(0, 3);
      const gaps = [...ranked].reverse().filter((c) => c.score < 0.7).slice(0, 3);
      const trend = await priorInDomain(sql, s.user_id, mv.domainId, sessionId);
      const next = await nextMode(sql, mv.domainId, gaps.map((g) => g.competencyId));
      const rubricVersions = [...new Set(mv.spec.stages.map((x) => x.rubricRef))];
      const scored = runs.find((r) => r.se_status === 'scored');
      return { s, evaluationId, mv, stages, agg, competencies, strengths, gaps, trend, next, rubricVersions, model: scored?.model ?? null, promptVersion: scored?.prompt_version ?? null };
    });
    if (plan === null) return;
    if (plan === 'wait') throw new RetryLater(5000, 'waiting for stage evaluations');

    // The narrative is written from the structured scores only.
    const summary = await evaluator.summarize(
      { userId: plan.s.user_id },
      {
        overallPercent: plan.agg.overall === null ? null : Math.round(plan.agg.overall * 100),
        competencies: plan.competencies.map((c) => ({ name: c.name, percent: Math.round(c.score * 100) })),
        strengths: plan.strengths.map((s) => s.name),
        gaps: plan.gaps.map((g) => g.name),
      },
    );
    const stageScores: StageScore[] = plan.stages.map((s) => ({ stageId: s.stageId, kind: s.kind, weight: s.weight, score: s.score, status: s.status, lowConfidence: s.lowConfidence }));
    const body: ReportBody = {
      overall: plan.agg.overall,
      lowConfidence: plan.agg.lowConfidence,
      headline: summary?.headline ?? 'Interview report',
      narrative: summary?.narrative ?? '',
      competencies: plan.competencies,
      stages: stageScores,
      strengths: plan.strengths,
      gaps: plan.gaps,
      trend: plan.trend,
      nextPractice: plan.next,
    };

    await db.tx(async (sql) => {
      const [moved] = await sql.query(
        `update evaluations set status = 'ready', overall = $2, rubric_versions = $3, model = $4, prompt_version = $5 where id = $1 and status = 'pending' returning id`,
        [plan.evaluationId, plan.agg.overall, JSON.stringify(plan.rubricVersions), plan.model, plan.promptVersion],
      );
      if (!moved) return;
      for (const c of plan.competencies) {
        await sql.query('insert into competency_scores (evaluation_id, competency_id, user_id, score, confidence, evidence) values ($1, $2, $3, $4, $5, $6)', [
          plan.evaluationId, c.competencyId, plan.s.user_id, c.score, c.confidence, JSON.stringify(c.evidence),
        ]);
      }
      await recordEvidence(sql, plan.s.user_id, 'interview', plan.competencies.map((c) => ({ competencyId: c.competencyId, score: c.score, confidence: c.confidence })));
      await saveReport(sql, plan.evaluationId, plan.s.user_id, body);
      await upsertSummary(sql, {
        sessionId, userId: plan.s.user_id, domainId: plan.mv.domainId, modeSlug: plan.mv.modeSlug, overall: plan.agg.overall,
        finishedAt: plan.s.ended_at ?? new Date(), topGaps: plan.gaps,
      });
      await track(sql, plan.s.user_id, 'evaluation_ready', { sessionId, evaluationId: plan.evaluationId, lowConfidence: plan.agg.lowConfidence });
      await enqueue(sql, 'recommend', { userId: plan.s.user_id, evaluationId: plan.evaluationId }, { key: `recommend:${plan.evaluationId}` });
    });
  }

  return { evaluateStage, finalizeEvaluation };
}

export function evaluationRoutes(route: Route, deps: { db: Db }) {
  const { db } = deps;

  route({ method: 'GET', url: '/v1/sessions/:id/evaluation', params: IdParams }, async ({ user, params, reply }): Promise<Evaluation | Pending> =>
    db.asUser(user.id, async (sql) => {
      const [s] = await sql.query('select 1 from sessions where id = $1', [params.id]);
      if (!s) throw notFound('session');
      const [e] = await sql.query<{ id: string; status: Evaluation['status']; overall: number | null; model: string | null; prompt_version: string | null }>(
        'select id, status, overall, model, prompt_version from evaluations where session_id = $1',
        [params.id],
      );
      const report = e ? await reportForSession(sql, params.id) : null;
      if (!e || e.status !== 'ready' || !report) {
        reply.status(202);
        return { status: 'pending' } as const;
      }
      return {
        id: e.id, sessionId: params.id, status: e.status, overall: e.overall, lowConfidence: report.body.lowConfidence,
        model: e.model, promptVersion: e.prompt_version, competencies: report.body.competencies, stages: report.body.stages,
      };
    }),
  );
}
