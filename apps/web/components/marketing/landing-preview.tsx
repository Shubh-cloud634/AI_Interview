'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Clock, MessageSquareText, Sparkles } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { TiltCard } from './landing-motion';

const TOTAL = 5;
const START_SEC = 150;
const sample = [
  { name: 'Structure', value: 78 },
  { name: 'Depth of reasoning', value: 64 },
  { name: 'Clarity', value: 85 },
];

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/**
 * A front-end preview of the interview room: question, answer box, timer, progress and a feedback panel.
 * Nothing here is sent anywhere and the feedback is a fixed illustration, labelled as such.
 */
export function InterviewPreview() {
  const reduce = useReducedMotion();
  const [sec, setSec] = useState(START_SEC);
  const [text, setText] = useState('');
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setSec((s) => (s <= 1 ? START_SEC : s - 1)), 1000);
    return () => clearInterval(t);
  }, [reduce]);

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <TiltCard className="glass overflow-hidden rounded-[22px] [perspective:1200px]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <div className="flex items-center gap-3">
          <span className="grid size-8 place-items-center rounded-full bg-accent-soft text-accent"><MessageSquareText size={15} aria-hidden /></span>
          <div>
            <p className="text-sm font-medium">Question 2 of {TOTAL}</p>
            <p className="text-xs text-muted">Business case · Preview</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5" role="img" aria-label={`Question 2 of ${TOTAL}`}>
          {Array.from({ length: TOTAL }, (_, i) => (
            <span key={i} className={`h-1.5 w-8 rounded-full ${i < 1 ? 'bg-accent-2' : i === 1 ? 'bg-accent' : 'bg-surface-2'}`} />
          ))}
        </div>
        <p className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 py-1 font-mono text-sm tabular-nums" aria-label="Sample timer">
          <Clock size={13} className="text-accent" aria-hidden /> {mmss(sec)}
        </p>
      </div>

      <div className="grid lg:grid-cols-[1.25fr_1fr]">
        <div className="space-y-4 p-5 sm:p-6">
          <p className="eyebrow">Sample question</p>
          <p className="text-lg font-medium leading-snug sm:text-xl">A retailer’s profit fell 20% year on year. Walk me through how you would find the cause.</p>
          <label className="block">
            <span className="sr-only">Your answer (preview only, nothing is saved)</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder="Type an answer to try the room. Nothing is sent or saved."
              className="w-full resize-none rounded-2xl border border-border bg-surface-2 p-4 text-sm leading-relaxed outline-none transition placeholder:text-muted focus:border-accent" />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted tabular-nums">{words} {words === 1 ? 'word' : 'words'} · preview only</p>
            <button type="button" onClick={() => setShown((v) => !v)} aria-expanded={shown}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface-2 px-5 text-sm font-medium transition hover:border-border-strong active:scale-[.97]">
              <Sparkles size={15} className="text-accent" aria-hidden /> {shown ? 'Hide sample feedback' : 'Show sample feedback'}
            </button>
          </div>
        </div>

        <div className="border-t border-border bg-surface-2/40 p-5 sm:p-6 lg:border-l lg:border-t-0">
          <p className="eyebrow mb-4">Feedback panel</p>
          <AnimatePresence mode="wait" initial={false}>
            {shown ? (
              <motion.div key="fb" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }} className="space-y-4">
                {sample.map((s) => (
                  <div key={s.name}>
                    <div className="mb-1.5 flex justify-between text-sm"><span>{s.name}</span><span className="tabular-nums text-muted">{s.value}</span></div>
                    <Progress label={s.name} value={s.value} />
                  </div>
                ))}
                <p className="rounded-xl border border-border bg-bg/40 p-3 text-xs leading-relaxed text-muted">“Good start splitting revenue and cost. Next, quantify each driver before proposing a cause.”</p>
                <p className="text-[11px] uppercase tracking-widest text-muted">Illustration, not a real score</p>
              </motion.div>
            ) : (
              <motion.p key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-sm leading-relaxed text-muted">
                After each answer Rehearse scores you against a rubric and quotes the part of your answer behind every score. Tap the button to see how it looks.
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>
    </TiltCard>
  );
}
