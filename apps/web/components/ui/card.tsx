'use client';

import { cn } from '@/lib/cn';
import { useRef, type HTMLAttributes, type PointerEvent } from 'react';

/**
 * Glass card with a subtle 3D tilt and a pointer-following spotlight. Both are driven by CSS variables
 * written straight to the element, so moving the pointer never re-renders React. Fine pointers only.
 */
export function Card({ className, onPointerMove, onPointerLeave, ...p }: HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: PointerEvent<HTMLDivElement>) => {
    onPointerMove?.(e);
    const el = ref.current;
    if (!el || e.pointerType !== 'mouse') return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty('--ry', `${((x - 0.5) * 5).toFixed(2)}deg`);
    el.style.setProperty('--rx', `${((0.5 - y) * 5).toFixed(2)}deg`);
    el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
    el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
  };
  const leave = (e: PointerEvent<HTMLDivElement>) => {
    onPointerLeave?.(e);
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  };
  return <div ref={ref} className={cn('glass tilt rounded-[var(--radius)] p-5 md:p-6', className)} onPointerMove={move} onPointerLeave={leave} {...p} />;
}

export function CardTitle({ className, ...p }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-[15px] font-semibold tracking-tight', className)} {...p} />;
}

/** Small uppercase label above a section or card. */
export function Eyebrow({ className, ...p }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('eyebrow', className)} {...p} />;
}
