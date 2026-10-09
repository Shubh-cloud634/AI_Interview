import type { StageKind } from '@ai-interview/shared';
import type { CriterionResult } from './evaluator';

export interface StageForAggregate {
  stageId: string;
  kind: StageKind;
  weight: number;
  status: 'scored' | 'failed' | 'skipped';
  score: number | null;
  lowConfidence: boolean;
  criteria: CriterionResult[];
}

export interface Aggregate {
  overall: number | null;
  lowConfidence: boolean;
  competencies: { competencyId: string; score: number; confidence: number; evidence: { quote: string; stageId: string; criterion: string }[] }[];
}

const MAX_EVIDENCE = 5;

/** Pure: overall and per-competency scores are weighted means of validated stage and criterion scores. */
export function aggregate(stages: StageForAggregate[]): Aggregate {
  const scored = stages.filter((s): s is StageForAggregate & { score: number } => s.status === 'scored' && s.score !== null);
  const w = scored.reduce((a, s) => a + s.weight, 0);
  const overall = w > 0 ? scored.reduce((a, s) => a + s.weight * s.score, 0) / w : null;

  const byComp = new Map<string, { num: number; den: number; conf: number; evidence: Aggregate['competencies'][number]['evidence'] }>();
  for (const s of scored) {
    for (const c of s.criteria) {
      const weight = c.weight * s.weight;
      const e = byComp.get(c.competencyId) ?? { num: 0, den: 0, conf: 0, evidence: [] };
      e.num += weight * c.score;
      e.den += weight;
      e.conf += weight * c.confidence;
      for (const q of c.evidence) if (e.evidence.length < MAX_EVIDENCE) e.evidence.push({ quote: q, stageId: s.stageId, criterion: c.name });
      byComp.set(c.competencyId, e);
    }
  }
  return {
    overall,
    lowConfidence: stages.some((s) => s.status === 'failed' || s.lowConfidence),
    competencies: [...byComp].map(([competencyId, e]) => ({ competencyId, score: e.num / e.den, confidence: e.conf / e.den, evidence: e.evidence })),
  };
}
