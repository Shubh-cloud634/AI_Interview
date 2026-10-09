import type { ReactNode } from 'react';
import type { CandidateContent, SessionState, StageRun } from '@ai-interview/shared';

export type PaneProps = {
  sessionId: string;
  stage: StageRun;
  question: NonNullable<SessionState['question']>;
  nextSeq: number;
  submitting: boolean;
  /** Resolves true once the server accepted the answer. */
  onSubmit: (content: CandidateContent) => Promise<boolean>;
  /** Panes that own the whole workspace (coding) place these beside their own panels. */
  rail?: ReactNode;
};
