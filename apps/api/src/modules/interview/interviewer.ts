import type { StageKind } from '@ai-interview/shared';
import type { AiContext, TaskDef, TaskRunner } from '../../ai/runner';

/**
 * INTERVIEWER role. Sees the candidate profile summary, the question source and prior turns.
 * Its inputs have no rubric or score fields, and it returns only text, so it cannot see or write scores.
 */

export interface TranscriptLine {
  actor: 'interviewer' | 'candidate';
  text: string;
}

export interface GenerateQuestionInput {
  promptRef: string;
  kind: StageKind;
  difficulty: number;
  profileSummary: string;
  previousQuestions: string[];
}

export interface FollowUpInput {
  kind: StageKind;
  question: string;
  transcript: TranscriptLine[];
  profileSummary: string;
}

const renderTranscript = (t: TranscriptLine[]) => t.map((l) => `${l.actor === 'interviewer' ? 'Interviewer' : 'Candidate'}: ${l.text}`).join('\n\n');

const generateQuestionTask: TaskDef<GenerateQuestionInput, string> = {
  role: 'interviewer',
  task: 'generateQuestion',
  promptRef: (i) => `interviewer/${i.promptRef}`,
  tier: 'primary',
  effort: 'low',
  maxTokens: 1500,
  vars: (i) => ({ kind: i.kind, difficulty: String(i.difficulty) }),
  data: (i) => ({ candidate_profile: i.profileSummary, previous_questions: i.previousQuestions.join('\n---\n') || 'none' }),
  maxDataChars: 8000,
  output: 'text',
};

const followUpTask: TaskDef<FollowUpInput, string> = {
  role: 'interviewer',
  task: 'followUp',
  promptRef: () => 'interviewer/follow-up.v1',
  tier: 'primary',
  effort: 'low',
  maxTokens: 1000,
  vars: (i) => ({ kind: i.kind }),
  data: (i) => ({ candidate_profile: i.profileSummary, question: i.question, transcript: renderTranscript(i.transcript) }),
  maxDataChars: 30_000,
  output: 'text',
};

export function createInterviewer(run: TaskRunner) {
  return {
    async generateQuestion(ctx: AiContext, input: GenerateQuestionInput, onToken?: (d: string) => void) {
      const r = await run(generateQuestionTask, input, ctx, { onToken });
      return { text: r.output, promptVersion: r.promptVersion };
    },
    async followUp(ctx: AiContext, input: FollowUpInput, onToken?: (d: string) => void) {
      const r = await run(followUpTask, input, ctx, { onToken });
      return { text: r.output, promptVersion: r.promptVersion };
    },
  };
}
export type Interviewer = ReturnType<typeof createInterviewer>;
