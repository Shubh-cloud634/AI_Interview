'use client';

import Link from 'next/link';
import { MotionConfig, motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { archivo } from './landing-font';
import { LandingHeader } from './landing-header';
import { LandingMosaic } from './landing-mosaic';

const expo = [0.16, 1, 0.3, 1] as const;
const lines = ['Prepare', 'smarter.', 'Interview', 'better.'];

/**
 * First screen. Desktop is viewport-locked (100svh) with the mosaic under the header card; below 1024px the
 * copy stacks over the mosaic. The rest of the page scrolls normally.
 */
export function LandingHero() {
  return (
    <MotionConfig reducedMotion="user">
      <section className={`${archivo.variable} lm relative isolate flex min-h-svh flex-col overflow-hidden lg:h-svh lg:min-h-[720px]`}>
        <LandingHeader />

        <div className="relative z-10 px-5 pt-[96px] sm:px-8 lg:w-[min(48vw,600px)] lg:flex-none lg:pl-[clamp(24px,6.7vw,86px)] lg:pr-0 lg:pt-[calc(142px+clamp(20px,6svh,64px))]">
          <h1 aria-label="Prepare smarter. Interview better." className="text-[clamp(3.1rem,15vw,4.4rem)] font-black uppercase leading-[0.94] tracking-[-0.06em] lg:text-[clamp(3.4rem,6.25vw,5rem)] [font-family:var(--font-archivo),var(--font-display)] [-webkit-text-stroke:1px_currentColor]">
            {lines.map((l, i) => (
              <span key={l} aria-hidden className="block overflow-hidden pb-[0.04em]">
                <motion.span className={`block ${i === 3 ? 'text-accent' : ''}`} initial={{ y: '110%' }} animate={{ y: 0 }} transition={{ duration: 1, delay: 0.3 + i * 0.085, ease: expo }}>{l}</motion.span>
              </span>
            ))}
          </h1>

          <motion.p className="mt-6 max-w-[460px] text-pretty text-base leading-relaxed text-muted lg:mt-8 lg:text-lg lg:leading-[1.48]" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.7, ease: expo }}>
            Rehearse is a serious practice room for your next interview: an <strong className="font-semibold text-fg">adaptive AI interviewer</strong>, tailored to your resume and target role, with honest feedback and a clear plan for what to work on next.
          </motion.p>

          <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-4 lg:mt-9">
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.82, ease: expo }}>
              <Link href="/register" className="group inline-flex h-16 items-center gap-3 rounded-full bg-fg py-1 pl-7 pr-1 text-base font-semibold text-bg transition hover:-translate-y-px">
                Start interview
                <span className="grid size-14 place-items-center rounded-full bg-accent text-accent-fg transition group-hover:rotate-[-45deg]"><ArrowRight size={22} aria-hidden /></span>
              </Link>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.9, ease: expo }}>
              <a href="#features" className="group inline-flex items-center gap-3 text-base font-bold">
                Explore platform
                <span className="grid size-8 place-items-center rounded-full bg-fg text-bg transition group-hover:rotate-[-45deg]"><ArrowRight size={15} aria-hidden /></span>
              </a>
            </motion.div>
          </div>
        </div>

        <div className="relative min-h-[300px] flex-1 lg:absolute lg:inset-0 lg:z-0 lg:min-h-0 lg:flex-none">
          <LandingMosaic />
        </div>
      </section>
    </MotionConfig>
  );
}
