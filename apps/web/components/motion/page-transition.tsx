'use client';

import { usePathname } from 'next/navigation';
import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

const ease = [0.16, 1, 0.3, 1] as const;

/** Fades and lifts a page in on navigation. Keyed by path so each route replays it. */
export function PageTransition({ children }: { children: ReactNode }) {
  const path = usePathname();
  const reduce = useReducedMotion();
  return (
    <motion.div key={path} initial={reduce ? false : { opacity: 0, y: 18, filter: 'blur(6px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ duration: 0.7, ease }}>
      {children}
    </motion.div>
  );
}

/** Staggers direct children in. Wrap a list or grid and give children <Item>. */
export function Stagger({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div className={className} initial="hide" animate="show" variants={{ show: { transition: { staggerChildren: 0.07, delayChildren: delay } } }}>
      {children}
    </motion.div>
  );
}

export function Item({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={{ hide: { opacity: 0, y: 22 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease } } }}>
      {children}
    </motion.div>
  );
}
