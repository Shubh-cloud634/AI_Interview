'use client';

import dynamic from 'next/dynamic';
import { useTheme } from 'next-themes';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useInView } from 'motion/react';
import { palettes } from '@/components/three/scene';
import { CodeTile, FeedbackTile, QuestionTile, RoleTile, ScoreTile, StatTile, TimerTile, WaveTile } from './landing-tiles';
import './landing.css';

const Scene = dynamic(() => import('@/components/three/scene'), { ssr: false });

/** One live R3F canvas inside a tile. Mounts once visible and idles (demand frames) when scrolled out of view. */
function SceneTile() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: '120px' });
  const { resolvedTheme } = useTheme();
  const [caps, setCaps] = useState<{ gl: boolean; still: boolean }>({ gl: false, still: true });
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    let gl = false;
    try { gl = !!document.createElement('canvas').getContext('webgl2'); } catch { /* no WebGL */ }
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setCaps({ gl, still: mq.matches });
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  useEffect(() => { if (inView) setSeen(true); }, [inView]);

  return (
    <div ref={ref} className="absolute inset-0">
      {caps.gl && seen && (
        <Scene variant="hero" palette={palettes[resolvedTheme === 'light' ? 'light' : 'dark']} still={caps.still || !inView} pos={[0, 0, 7.4]} />
      )}
      <p className="absolute bottom-[8cqw] left-[8cqw] text-[6.5cqw] font-semibold uppercase tracking-[0.14em] text-[#fbf5ea]">Your room, in 3D</p>
    </div>
  );
}

type Tone = 'coral' | 'lime' | 'yellow' | 'cream' | 'dark';
type Cell = [Tone, ReactNode];

const stat1 = <StatTile value="1:1" label="Interviewer" note="One question at a time" />;
const stat2 = <StatTile value="24/7" label="Practice room" note="Open whenever you are" />;
const stat3 = <StatTile value="Any" label="Domain" note="Engineering to finance" />;

const columns: { cls: string; cells: Cell[] }[] = [
  { cls: 'lm-x2', cells: [['dark', <CodeTile key="a" />], ['lime', <RoleTile key="b" />], ['cream', <ScoreTile key="c" value={68} />], ['coral', <WaveTile key="d" />], ['yellow', stat3]] },
  { cls: 'lm-x1 up', cells: [['cream', <QuestionTile key="a" n={5} />], ['coral', stat2], ['dark', <ScoreTile key="c" value={88} />], ['lime', <FeedbackTile key="d" />], ['yellow', <WaveTile key="e" />]] },
  { cls: 'lm-c1', cells: [['coral', <WaveTile key="a" />], ['cream', <QuestionTile key="b" />], ['dark', <ScoreTile key="c" />], ['lime', <RoleTile key="d" />], ['yellow', stat1]] },
  { cls: 'lm-c2 up', cells: [['yellow', <TimerTile key="a" />], ['dark', <SceneTile key="b" />], ['dark', <CodeTile key="c" />], ['cream', <FeedbackTile key="d" />], ['coral', stat2]] },
  { cls: 'lm-c3', cells: [['lime', stat3], ['cream', <ScoreTile key="b" value={91} />], ['dark', <WaveTile key="c" />], ['yellow', <QuestionTile key="d" n={4} />], ['coral', <TimerTile key="e" />]] },
];

/** Decorative: hidden from assistive tech. Each column renders its 5 cells twice so a -50% translate loops seamlessly. */
export function LandingMosaic() {
  return (
    <motion.div aria-hidden className="lm-mosaic pointer-events-none absolute inset-0" initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.1, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}>
      <div className="lm-grid">
        {columns.map((col) => (
          <div key={col.cls} className={`lm-col ${col.cls}`}>
            {[0, 1].map((copy) => cellsOf(col.cells, copy))}
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function cellsOf(cells: Cell[], copy: number) {
  return cells.map(([tone, body], i) => (
    <div key={`${copy}-${i}`} className={`lm-cell lm-${tone}`}>
      {body}
    </div>
  ));
}
