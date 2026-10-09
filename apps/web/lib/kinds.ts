import { BookOpenCheck, Calculator, Code2, FileText, MessagesSquare, PenTool, type LucideIcon } from 'lucide-react';
import type { StageKind } from '@ai-interview/shared';

/** Presentation for each interaction kind. Keyed on kind only, so a new career domain needs nothing here. */
export const kindMeta: Record<StageKind, { label: string; icon: LucideIcon; blurb: string }> = {
  conversation: { label: 'Conversation', icon: MessagesSquare, blurb: 'Spoken-style Q&A with follow-ups' },
  coding: { label: 'Coding', icon: Code2, blurb: 'Write and run code against tests' },
  case: { label: 'Case', icon: BookOpenCheck, blurb: 'Structure and solve a business case' },
  quant: { label: 'Quant', icon: Calculator, blurb: 'Work through numbers out loud' },
  document: { label: 'Document', icon: FileText, blurb: 'Review or write a document' },
  whiteboard: { label: 'Whiteboard', icon: PenTool, blurb: 'Design and explain a system' },
};
