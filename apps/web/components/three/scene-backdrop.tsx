'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '@/lib/cn';
import { palettes, type SceneVariant } from './scene';

const Scene = dynamic(() => import('./scene'), { ssr: false });

/** Which 3D scene each route gets, so every page has its own object but one visual language. */
export function variantFor(path: string): SceneVariant {
  if (path === '/' || path.startsWith('/login') || path.startsWith('/register')) return 'hero';
  if (path.startsWith('/dashboard')) return 'bars';
  if (path.startsWith('/interview')) return 'rings';
  if (path.startsWith('/history') || path.startsWith('/report') || path.includes('/results')) return 'helix';
  return 'shards';
}

function useCapabilities() {
  const [caps, setCaps] = useState<{ gl: boolean; still: boolean } | null>(null);
  useEffect(() => {
    let gl = false;
    try { gl = !!document.createElement('canvas').getContext('webgl2'); } catch { /* no WebGL */ }
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setCaps({ gl, still: mq.matches });
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return caps;
}

/** A decorative, non-interactive WebGL layer behind page content. Cross-fades when the route's scene changes. */
export function SceneBackdrop({ variant, className }: { variant: SceneVariant; className?: string }) {
  const caps = useCapabilities();
  const { resolvedTheme } = useTheme();
  const palette = palettes[resolvedTheme === 'light' ? 'light' : 'dark'];
  if (!caps?.gl) return null;
  return (
    <div aria-hidden className={cn('pointer-events-none fixed inset-0 -z-10', className)}>
      <AnimatePresence mode="popLayout">
        <motion.div key={variant} className="absolute inset-0" initial={{ opacity: 0, scale: 1.06 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}>
          <Scene variant={variant} palette={palette} still={caps.still} />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export function RouteBackdrop({ className }: { className?: string }) {
  return <SceneBackdrop variant={variantFor(usePathname())} className={className} />;
}
