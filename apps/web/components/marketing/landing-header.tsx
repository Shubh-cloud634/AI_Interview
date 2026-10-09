'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Menu, X } from 'lucide-react';
import { Logo } from '@/components/layout/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { CtaLink } from './cta-button';

const expo = [0.16, 1, 0.3, 1] as const;

const links = [
  { id: 'features', label: 'Features' },
  { id: 'how', label: 'How it works' },
  { id: 'preview', label: 'Preview' },
  { id: 'modes', label: 'Interview modes' },
  { id: 'results', label: 'Results' },
];
const ids = links.map((l) => l.id);

/** Which section is under the middle of the viewport, for the active link highlight. */
function useScrollSpy() {
  const [active, setActive] = useState('');
  useEffect(() => {
    const els = ids.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setActive(e.target.id)),
      { rootMargin: '-45% 0px -50% 0px' },
    );
    els.forEach((el) => io.observe(el));
    const top = () => { if (window.scrollY < 200) setActive(''); };
    window.addEventListener('scroll', top, { passive: true });
    return () => { io.disconnect(); window.removeEventListener('scroll', top); };
  }, []);
  return active;
}

/**
 * One fixed bar: logo left, section links centre, sign in, theme and the primary CTA right.
 * Below xl the links move into a menu panel. Every anchored section has scroll-mt so nothing hides under the bar.
 */
export function LandingHeader() {
  const [open, setOpen] = useState(false);
  const [raised, setRaised] = useState(false);
  const root = useRef<HTMLElement>(null);
  const firstLink = useRef<HTMLAnchorElement>(null);
  const active = useScrollSpy();

  useEffect(() => {
    const on = () => setRaised(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  useEffect(() => {
    if (!open) return;
    firstLink.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: PointerEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
  }, [open]);

  return (
    <motion.header ref={root} initial={{ y: -90, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.9, ease: expo }}
      className="fixed inset-x-3 top-3 z-40 mx-auto max-w-[1240px] sm:inset-x-5">
      <div className={`rounded-2xl border border-border backdrop-blur-xl transition-[background-color,box-shadow] duration-300 ${raised ? 'bg-bg/85 shadow-[0_18px_40px_-22px_rgba(0,0,0,.7)]' : 'bg-bg/72'}`}>
        <div className="flex h-16 items-center justify-between gap-3 pl-4 pr-2.5 sm:pl-5">
          <Link href="/" aria-label="Rehearse home" className="shrink-0 rounded-lg"><Logo /></Link>

          <nav aria-label="Main navigation" className="hidden items-center gap-0.5 xl:flex">
            {links.map((l) => (
              <a key={l.id} href={`#${l.id}`} aria-current={active === l.id ? 'true' : undefined}
                className={`relative rounded-full px-4 py-2 text-sm font-medium transition-colors ${active === l.id ? 'text-fg' : 'text-muted hover:text-fg'}`}>
                {active === l.id && <motion.span layoutId="nav-pill" className="absolute inset-0 -z-10 rounded-full bg-surface-2 shadow-[inset_0_0_0_1px_var(--border)]" transition={{ type: 'spring', stiffness: 380, damping: 32 }} />}
                {l.label}
              </a>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-1.5">
            <Link href="/login" className="hidden rounded-full px-3.5 py-2 text-sm font-medium text-muted transition hover:bg-surface-2 hover:text-fg sm:inline-flex">Sign in</Link>
            <ThemeToggle />
            <CtaLink className="hidden sm:inline-flex" />
            <button type="button" aria-expanded={open} aria-controls="landing-menu" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen((v) => !v)}
              className="grid size-11 place-items-center rounded-full border border-border transition hover:bg-surface-2 xl:hidden">
              {open ? <X size={18} aria-hidden /> : <Menu size={18} aria-hidden />}
            </button>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {open && (
            <motion.nav id="landing-menu" aria-label="Site sections" className="overflow-hidden border-t border-border xl:hidden" initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} transition={{ duration: 0.35, ease: expo }}>
              <ul className="flex flex-col gap-0.5 p-2.5">
                {links.map((l, i) => (
                  <motion.li key={l.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.04 + i * 0.04, duration: 0.35, ease: expo }}>
                    <a ref={i === 0 ? firstLink : undefined} href={`#${l.id}`} onClick={() => setOpen(false)}
                      className={`flex min-h-11 items-center rounded-xl px-3.5 text-base font-medium hover:bg-surface-2 ${active === l.id ? 'bg-surface-2' : ''}`}>{l.label}</a>
                  </motion.li>
                ))}
                <li className="mt-1.5 flex items-center justify-between gap-2 border-t border-border px-1 pt-3">
                  <Link href="/login" onClick={() => setOpen(false)} className="inline-flex min-h-11 items-center rounded-full border border-border px-5 text-sm font-medium">Sign in</Link>
                  <CtaLink onClick={() => setOpen(false)} />
                </li>
              </ul>
            </motion.nav>
          )}
        </AnimatePresence>
      </div>
    </motion.header>
  );
}
