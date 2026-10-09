'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Menu, X } from 'lucide-react';
import { Logo } from '@/components/layout/logo';
import { ThemeToggle } from '@/components/theme-toggle';

const expo = [0.16, 1, 0.3, 1] as const;

const links = [
  { href: '#features', label: 'Features' },
  { href: '#how', label: 'How it works' },
  { href: '#modes', label: 'Interview modes' },
  { href: '#careers', label: 'Career intelligence' },
  { href: '#about', label: 'About' },
];

/**
 * Floating card pinned to the top of the hero. Desktop: utility strip over a main row.
 * Mobile: logo and menu only; everything else lives in the expandable panel.
 */
export function LandingHeader() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: PointerEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
  }, [open]);

  return (
    <motion.header
      ref={root}
      data-open={open || undefined}
      initial={{ y: -180 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.95, ease: expo }}
      className="glass absolute inset-x-3 top-0 z-30 rounded-b-[22px] border-t-0 lg:inset-x-10"
    >
      <motion.div className="hidden h-10 items-center justify-between border-b border-border px-6 text-[13px] text-muted lg:flex" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.32, duration: 0.6 }}>
        <p className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-accent" /> Live AI interviewer · 30 to 40 minute sessions · Evidence for every score</p>
        <div className="flex items-center gap-1">
          {links.slice(3).map((l) => <a key={l.href} href={l.href} className="rounded-full px-3 py-1 font-medium transition hover:bg-surface-2 hover:text-fg">{l.label}</a>)}
          <Link href="/login" className="rounded-full px-3 py-1 font-medium text-fg transition hover:bg-surface-2">Sign in</Link>
          <ThemeToggle />
        </div>
      </motion.div>

      <div className="flex h-[68px] items-center justify-between gap-4 px-4 lg:h-[102px] lg:px-6">
        <Link href="/" aria-label="Rehearse home" className="scale-100 lg:scale-125 lg:origin-left"><Logo /></Link>

        <nav aria-label="Main navigation" className="hidden items-center gap-1 lg:flex">
          {links.slice(0, 3).map((l, i) => (
            <motion.a key={l.href} href={l.href} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 + i * 0.06, duration: 0.6, ease: expo }}
              className="rounded-full px-4 py-2 text-[15px] font-medium transition hover:bg-surface-2">{l.label}</motion.a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link href="/register" aria-label="Start interview" className="group hidden h-[52px] items-center gap-3 rounded-full bg-fg py-1 pl-6 pr-1 text-[15px] font-semibold text-bg transition hover:-translate-y-px sm:inline-flex lg:h-16">
            Start interview
            <span className="grid size-11 place-items-center rounded-full bg-accent text-accent-fg transition group-hover:rotate-[-45deg] lg:size-14"><ArrowRight size={20} aria-hidden /></span>
          </Link>
          <button type="button" aria-expanded={open} aria-controls="landing-menu" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen((v) => !v)}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium transition hover:bg-surface-2 lg:hidden">
            {open ? <X size={16} aria-hidden /> : <Menu size={16} aria-hidden />} Menu
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.nav id="landing-menu" aria-label="Useful links" className="overflow-hidden border-t border-border lg:hidden" initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} transition={{ duration: 0.4, ease: expo }}>
            <ul className="flex flex-col gap-1 p-3">
              {links.map((l, i) => (
                <motion.li key={l.href} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 + i * 0.045, duration: 0.4, ease: expo }}>
                  <a href={l.href} onClick={() => setOpen(false)} className="block rounded-xl px-3 py-3 text-base font-medium hover:bg-surface-2">{l.label}</a>
                </motion.li>
              ))}
              <li className="mt-1 flex items-center gap-2 px-1 pb-1">
                <Link href="/register" onClick={() => setOpen(false)} className="inline-flex h-11 flex-1 items-center justify-center rounded-full bg-fg text-sm font-semibold text-bg">Start interview</Link>
                <Link href="/login" onClick={() => setOpen(false)} className="inline-flex h-11 items-center rounded-full border border-border px-5 text-sm font-medium">Sign in</Link>
                <ThemeToggle />
              </li>
            </ul>
          </motion.nav>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
