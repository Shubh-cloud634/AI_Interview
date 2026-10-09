import { cn } from '@/lib/cn';
import type { HTMLAttributes } from 'react';

type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'bad';

const tones: Record<Tone, string> = {
  neutral: 'border-border bg-surface-2 text-muted',
  accent: 'border-accent/40 bg-accent-soft text-accent',
  good: 'border-good/40 bg-good/10 text-good',
  warn: 'border-warn/40 bg-warn/10 text-warn',
  bad: 'border-bad/40 bg-bad/10 text-bad',
};

export function Badge({ tone = 'neutral', className, ...p }: { tone?: Tone } & HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium', tones[tone], className)} {...p} />;
}

/** How much we trust a piece of candidate data. Never show a guess as a fact. */
export type Certainty = 'fact' | 'inference' | 'unknown';

const certainty: Record<Certainty, { label: string; tone: Tone; hint: string }> = {
  fact: { label: 'Fact', tone: 'good', hint: 'Stated in your resume or entered by you' },
  inference: { label: 'Inference', tone: 'accent', hint: 'Derived by the platform, not stated directly' },
  unknown: { label: 'Unknown', tone: 'neutral', hint: 'Not found yet' },
};

export function CertaintyBadge({ kind }: { kind: Certainty }) {
  const c = certainty[kind];
  return (
    <Badge tone={c.tone} title={c.hint} className="font-mono text-[10px] uppercase tracking-wider">
      {c.label}
    </Badge>
  );
}
