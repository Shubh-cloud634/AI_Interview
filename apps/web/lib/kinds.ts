import { BookOpenCheck, Calculator, Code2, Cpu, FileText, MessagesSquare, PenTool, Users, type LucideIcon } from 'lucide-react';
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

/**
 * The four interview types a candidate picks first. Each maps to one mode per domain by slug
 * (`<type>-interview`); a domain without that mode simply shows the type as unavailable.
 */
export const interviewTypes = [
  { id: 'technical', slug: 'technical-interview', label: 'Technical', icon: Cpu, blurb: 'Questions on the skills, tools and projects on your resume, rising from fundamentals to design trade-offs.' },
  { id: 'coding', slug: 'coding-interview', label: 'Coding', icon: Code2, blurb: 'Solve problems in a live editor against hidden tests, then explain your approach.' },
  { id: 'hr', slug: 'hr-interview', label: 'HR', icon: Users, blurb: 'Motivation, strengths, teamwork and fit, anchored in your own career story.' },
  { id: 'behavioral', slug: 'behavioral-interview', label: 'Behavioral', icon: MessagesSquare, blurb: 'Tell-me-about-a-time questions on teamwork, setbacks and leadership, answered in STAR form.' },
] as const satisfies readonly { id: string; slug: string; label: string; icon: LucideIcon; blurb: string }[];

export type InterviewTypeId = (typeof interviewTypes)[number]['id'];
