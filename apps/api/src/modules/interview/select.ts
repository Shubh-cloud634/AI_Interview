import type { ModeSpec, StageSpec } from '@ai-interview/shared';
import type { BankQuestion } from '../catalog/catalog';

export type QuestionRef =
  | { type: 'bank'; templateId: string; difficulty: number }
  | { type: 'generated'; promptRef: string; difficulty: number };

export interface SelectionInput {
  stage: StageSpec;
  adaptivity: ModeSpec['adaptivity'];
  /** Mean readiness over the stage rubric's competencies, or null when unknown. */
  readiness: number | null;
  /** Templates this candidate has already been asked, in any session. */
  askedTemplateIds: ReadonlySet<string>;
  bank: BankQuestion[];
  seed: number;
  stageIdx: number;
}

const DEFAULT_DIFFICULTY = 2;

/** Pure: (stageSpec, readiness, history, bank) -> QuestionRef. Never looks at the domain. */
export function selectQuestion(i: SelectionInput): QuestionRef {
  const base = i.stage.questionSource.difficulty ?? DEFAULT_DIFFICULTY;
  const raise = i.adaptivity && i.readiness !== null && i.readiness >= i.adaptivity.minScoreToRaise ? i.adaptivity.difficultyStep : 0;
  const target = Math.min(5, base + raise);

  if (i.stage.questionSource.type === 'generated') {
    return { type: 'generated', promptRef: i.stage.questionSource.promptRef, difficulty: target };
  }
  if (i.bank.length === 0) throw new Error(`no bank question for stage ${i.stage.id}`);
  const fresh = i.bank.filter((q) => !i.askedTemplateIds.has(q.id));
  const pool = fresh.length > 0 ? fresh : i.bank;
  const best = Math.min(...pool.map((q) => Math.abs(q.difficulty - target)));
  const closest = pool.filter((q) => Math.abs(q.difficulty - target) === best).sort((a, b) => a.id.localeCompare(b.id));
  const pick = closest[(i.seed + i.stageIdx) % closest.length]!;
  return { type: 'bank', templateId: pick.id, difficulty: pick.difficulty };
}
