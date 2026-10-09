'use client';

import { useEffect, useState } from 'react';
import { Check, Circle, Clock, Hourglass } from 'lucide-react';
import type { Session, SessionState } from '@ai-interview/shared';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/cn';
import { mmss } from '@/lib/format';
import { label } from '@/lib/insights';
import { kindMeta } from '@/lib/kinds';

/** One shared clock tick per consumer; the server deadline stays authoritative for enforcement. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export type Clocks = { stageLeft: number | null; sessionLeft: number | null };

/** Seconds left in the current stage, and in the whole session (current stage plus stages not started). */
export function useClocks(session: Session, state: SessionState): Clocks {
  const now = useNow();
  const stage = state.currentStage;
  const stageLeft = stage?.deadlineAt ? Math.max(0, (new Date(stage.deadlineAt).getTime() - now) / 1000) : null;
  const upcoming = session.stages.filter((s) => s.status === 'pending').reduce((n, s) => n + (s.timeLimitSec ?? 0), 0);
  return { stageLeft, sessionLeft: stageLeft === null ? null : stageLeft + upcoming };
}

export function ClockReadout({ seconds, label: l, strong = false }: { seconds: number | null; label: string; strong?: boolean }) {
  if (seconds === null) return null;
  const low = seconds < 60;
  return (
    <span role="timer" aria-label={`${l} remaining`} className={cn('inline-flex items-center gap-1.5 font-mono tabular-nums', strong ? 'text-sm' : 'text-xs', low ? 'text-bad' : strong ? 'text-fg' : 'text-muted')}>
      <Clock size={strong ? 14 : 12} aria-hidden /> {seconds <= 0 ? 'Time is up' : mmss(seconds)}
    </span>
  );
}

export function RoomRail({ session, state, clocks }: { session: Session; state: SessionState; clocks: Clocks }) {
  const done = session.stages.filter((s) => s.status === 'completed').length;
  const stage = state.currentStage;
  const questionNo = Math.max(1, state.turns.filter((t) => t.actor === 'interviewer').length);
  return (
    <div className="space-y-4">
      <div className="glass rounded-2xl p-5">
        <p className="eyebrow">Mode</p>
        <p className="mt-1.5 font-medium">{session.modeName}</p>
        {stage && <p className="mt-0.5 text-xs capitalize text-muted">{kindMeta[stage.kind].label} · {label(stage.stageId)}</p>}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-border bg-surface-2 p-3"><p className="flex items-center gap-1 text-[11px] text-muted"><Hourglass size={11} aria-hidden /> This stage</p><div className="mt-1"><ClockReadout seconds={clocks.stageLeft} label="Stage" strong /></div></div>
          <div className="rounded-xl border border-border bg-surface-2 p-3"><p className="flex items-center gap-1 text-[11px] text-muted"><Clock size={11} aria-hidden /> Session</p><div className="mt-1"><ClockReadout seconds={clocks.sessionLeft} label="Session" strong /></div></div>
        </div>
        <p className="mt-4 text-xs text-muted">Question {questionNo} in this stage</p>
      </div>

      <div className="glass rounded-2xl p-5">
        <div className="mb-3 flex items-center justify-between"><p className="eyebrow">Progress</p><p className="text-xs text-muted">{done} of {session.stages.length} stages</p></div>
        <Progress label="Session progress" value={(done / Math.max(1, session.stages.length)) * 100} />
        <ol className="mt-4 space-y-3">
          {session.stages.map((s) => {
            const active = s.id === stage?.id;
            const Icon = kindMeta[s.kind].icon;
            return (
              <li key={s.id} aria-current={active ? 'step' : undefined} className={cn('flex items-center gap-3 text-sm', !active && s.status !== 'completed' && 'text-muted')}>
                <span className={cn('grid size-7 shrink-0 place-items-center rounded-full', s.status === 'completed' ? 'bg-good/15 text-good' : active ? 'bg-accent-soft text-accent' : 'bg-surface-2')}>
                  {s.status === 'completed' ? <Check size={14} aria-hidden /> : active ? <Icon size={14} aria-hidden /> : <Circle size={9} aria-hidden />}
                </span>
                <span className="min-w-0 flex-1"><span className="block truncate capitalize">{label(s.stageId)}</span>{s.timeLimitSec && <span className="text-[11px] text-muted">{Math.round(s.timeLimitSec / 60)} min</span>}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
