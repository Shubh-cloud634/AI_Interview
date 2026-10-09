'use client';

import { motion } from 'motion/react';
import type { ReactNode } from 'react';

const ease = [0.16, 1, 0.3, 1] as const;
const up = (delay: number) => ({ initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.8, ease, delay } });

export function PageHeader({ title, subtitle, eyebrow, action }: { title: string; subtitle?: string; eyebrow?: string; action?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4 md:mb-10">
      <div>
        {eyebrow && <motion.p {...up(0)} className="eyebrow mb-3 flex items-center gap-2"><span className="h-px w-6 bg-accent" />{eyebrow}</motion.p>}
        <motion.h1 {...up(0.08)} className="display text-3xl md:text-6xl">{title}</motion.h1>
        {subtitle && <motion.p {...up(0.18)} className="mt-3 max-w-xl text-pretty text-muted md:text-lg">{subtitle}</motion.p>}
      </div>
      {action && <motion.div {...up(0.26)}>{action}</motion.div>}
    </div>
  );
}
