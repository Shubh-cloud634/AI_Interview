'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';

export type AvatarState = 'listening' | 'thinking' | 'speaking';

const label: Record<AvatarState, string> = {
  listening: 'Listening to you',
  thinking: 'Thinking',
  speaking: 'Speaking',
};

const Orb = dynamic(() => import('./orb'), { ssr: false, loading: () => <Fallback state="listening" /> });

function webglAvailable() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

function Fallback({ state }: { state: AvatarState }) {
  return (
    <div className="grid size-full place-items-center">
      <div className={cn('size-16 rounded-full bg-gradient-to-br from-accent to-accent-2', state !== 'listening' && 'animate-pulse')} />
    </div>
  );
}

/** The orb is a status indicator: its motion tells the candidate who is talking, not decoration. */
export function Avatar({ state, compact = false }: { state: AvatarState; compact?: boolean }) {
  const [mode, setMode] = useState<'pending' | '3d' | '2d'>('pending');
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setMode(!reduce && webglAvailable() ? '3d' : '2d');
  }, []);

  return (
    <div className={cn('flex items-center gap-3', compact ? 'flex-row' : 'flex-col')}>
      <div className={cn('relative', compact ? 'size-14' : 'size-40 md:size-48')} aria-hidden>
        <div className={cn('absolute inset-2 rounded-full blur-2xl transition-colors duration-500', state === 'speaking' ? 'bg-accent-2/40' : state === 'thinking' ? 'bg-warm/30' : 'bg-accent/30')} />
        <div className="relative size-full">{mode === '3d' ? <Orb state={state} /> : <Fallback state={state} />}</div>
      </div>
      <div className={cn(compact ? '' : 'text-center')}>
        <p className="font-medium">Aria</p>
        <p role="status" className="flex items-center gap-2 text-xs text-muted" style={{ justifyContent: compact ? 'flex-start' : 'center' }}>
          <span className="relative grid size-2 place-items-center"><span className={cn('absolute size-2 rounded-full bg-accent-2', state !== 'listening' && 'ping-soft')} /><span className="size-1.5 rounded-full bg-accent-2" /></span>
          {label[state]}
        </p>
      </div>
    </div>
  );
}
