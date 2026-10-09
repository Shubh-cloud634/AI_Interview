import type { CandidateContent, SessionStatus, StageSpec } from '@ai-interview/shared';
import { invalidState } from '../../http/errors';

/** created -> in_stage(n) -> awaiting_answer -> processing -> in_stage(n+1) -> completed | abandoned */
export interface EngineState {
  status: SessionStatus;
  stageIdx: number | null;
}

export type EngineEvent =
  | { type: 'start' }
  | { type: 'ask' }
  | { type: 'answer' }
  | { type: 'follow_up' }
  | { type: 'complete_stage' }
  | { type: 'end' };

export function transition(s: EngineState, e: EngineEvent, stageCount: number): EngineState {
  const bad = () => invalidState(`cannot ${e.type} while ${s.status}`);
  if (e.type === 'end') {
    if (s.status === 'completed' || s.status === 'abandoned') throw bad();
    return { status: 'abandoned', stageIdx: s.stageIdx };
  }
  switch (s.status) {
    case 'created':
      if (e.type === 'start') return { status: 'in_stage', stageIdx: 0 };
      break;
    case 'in_stage':
      if (e.type === 'ask') return { status: 'awaiting_answer', stageIdx: s.stageIdx };
      break;
    case 'awaiting_answer':
      if (e.type === 'answer') return { status: 'processing', stageIdx: s.stageIdx };
      break;
    case 'processing': {
      if (e.type === 'follow_up') return { status: 'awaiting_answer', stageIdx: s.stageIdx };
      if (e.type === 'complete_stage') {
        const next = (s.stageIdx ?? 0) + 1;
        return next < stageCount ? { status: 'in_stage', stageIdx: next } : { status: 'completed', stageIdx: s.stageIdx };
      }
      break;
    }
  }
  throw bad();
}

export function run(s: EngineState, events: EngineEvent['type'][], stageCount: number): EngineState {
  return events.reduce((acc, type) => transition(acc, { type } as EngineEvent, stageCount), s);
}

/** Stage handler: the same rule for every kind. A stage ends after maxTurns candidate answers. */
export function nextStep(stage: StageSpec, candidateTurnsInStage: number, _content: CandidateContent): 'follow_up' | 'complete_stage' {
  return candidateTurnsInStage < (stage.maxTurns ?? 1) ? 'follow_up' : 'complete_stage';
}
