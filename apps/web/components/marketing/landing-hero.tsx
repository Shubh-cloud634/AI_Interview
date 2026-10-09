'use client';

import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { archivo } from './landing-font';
import { CtaLink } from './cta-button';
import { LandingMosaic } from './landing-mosaic';

const expo = [0.16, 1, 0.3, 1] as const;
const lines = ['Prepare', 'smarter.', 'Interview', 'better.'];

/**
 * First screen. Desktop is viewport-locked (100svh) with the tile mosaic behind the copy, tilted in perspective and
 * following the mouse a few degrees. Below 1024px the copy stacks over a flat mosaic. The page scrolls on below it.
 */
export function LandingHero() {
  const reduce = useReducedMotion();
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 90, damping: 20 });
  const sy = useSpring(py, { stiffness: 90, damping: 20 });
  const rotateY = useTransform(sx, [-0.5, 0.5], [-13, -5]);
  const rotateX = useTransform(sy, [-0.5, 0.5], [6, 0]);
  const orbX = useTransform(sx, [-0.5, 0.5], [-24, 24]);
  const orbY = useTransform(sy, [-0.5, 0.5], [-16, 16]);

  return (
    <section
      className={`${archivo.variable} lm relative isolate flex min-h-svh flex-col overflow-hidden lg:h-svh lg:min-h-[540px]`}
      onPointerMove={(e) => {
        if (reduce || e.pointerType !== 'mouse') return;
        const r = e.currentTarget.getBoundingClientRect();
        px.set((e.clientX - r.left) / r.width - 0.5);
        py.set((e.clientY - r.top) / r.height - 0.5);
      }}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <motion.div style={reduce ? undefined : { x: orbX, y: orbY }} className="drift absolute -left-[12%] top-[8%] size-[min(60vw,640px)] rounded-full bg-accent/25 blur-[110px]" />
        <motion.div style={reduce ? undefined : { x: orbX, y: orbY }} className="drift absolute -right-[8%] bottom-[-10%] size-[min(50vw,520px)] rounded-full bg-accent-2/15 blur-[120px] [animation-delay:-6s]" />
      </div>

      <div className="relative z-10 px-5 pt-[104px] sm:px-8 lg:flex lg:w-[min(48vw,600px)] lg:flex-1 lg:flex-col lg:[@media(min-height:880px)]:justify-center lg:pl-[clamp(24px,6.7vw,86px)] lg:pr-0 lg:pb-[clamp(16px,3.5svh,40px)] lg:pt-[calc(88px+clamp(8px,3svh,40px))]">
        <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.2, ease: expo }}
          className="mb-5 inline-flex items-center gap-2 self-start rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs font-medium text-muted lg:mb-[clamp(10px,2.4svh,28px)]">
          <span className="relative grid size-2 place-items-center"><span className="ping-soft absolute size-2 rounded-full bg-accent" /><span className="size-1.5 rounded-full bg-accent" /></span>
          Live AI interviewer · Evidence for every score
        </motion.p>

        <h1 aria-label="Prepare smarter. Interview better." className="text-[clamp(3rem,14.5vw,4.4rem)] font-black uppercase leading-[0.95] tracking-[-0.06em] lg:text-[clamp(2.6rem,min(6.25vw,10.6svh),5rem)] [font-family:var(--font-archivo),var(--font-display)] [-webkit-text-stroke:1px_currentColor]">
          {lines.map((l, i) => (
            <span key={l} aria-hidden className="block overflow-hidden pb-[0.05em]">
              <motion.span className={`block ${i === 3 ? 'text-accent' : ''}`} initial={{ y: '110%' }} animate={{ y: 0 }} transition={{ duration: 1, delay: 0.3 + i * 0.085, ease: expo }}>{l}</motion.span>
            </span>
          ))}
        </h1>

        <motion.p className="mt-6 max-w-[30rem] text-pretty text-base leading-relaxed text-muted lg:mt-[clamp(12px,2.6svh,32px)] lg:text-[clamp(15px,2.3svh,18px)] lg:leading-[1.5]" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.7, ease: expo }}>
          Rehearse is a serious practice room for your next interview: an <strong className="font-semibold text-fg">adaptive AI interviewer</strong>, tailored to your resume, with honest feedback and a clear plan for what to work on next.
        </motion.p>

        <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-4 lg:mt-[clamp(14px,3svh,36px)]">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.82, ease: expo }}>
            <CtaLink size="lg" />
          </motion.div>
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.9, ease: expo }}>
            <a href="#features" className="group inline-flex min-h-11 items-center gap-3 whitespace-nowrap text-base font-bold">
              Explore platform
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-fg text-bg transition group-hover:rotate-[-45deg]"><ArrowRight size={15} aria-hidden /></span>
            </a>
          </motion.div>
        </div>
      </div>

      <div className="relative min-h-[320px] flex-1 [perspective:1500px] lg:absolute lg:inset-0 lg:z-0 lg:min-h-0 lg:flex-none">
        <motion.div
          className="absolute inset-0 [transform-style:preserve-3d] max-lg:!transform-none"
          style={reduce ? { rotateY: -9, rotateX: 3, transformOrigin: '78% 50%' } : { rotateY, rotateX, transformOrigin: '78% 50%' }}
        >
          <LandingMosaic />
        </motion.div>
      </div>
    </section>
  );
}
