import { useId } from 'react';
import { cn } from '@/lib/cn';

/** Circular score. `size` is a Tailwind size class so callers can scale it. */
export function ScoreRing({ value, label, className, caption }: { value: number; label: string; className?: string; caption?: string }) {
  const id = useId();
  const pct = Math.max(0, Math.min(100, value));
  const r = 44;
  const circ = 2 * Math.PI * r;
  return (
    <div className={cn('relative size-36', className)} role="img" aria-label={`${label}: ${Math.round(pct)} out of 100`}>
      <div aria-hidden className="absolute inset-4 rounded-full bg-accent/20 blur-2xl" />
      <svg viewBox="0 0 100 100" className="relative size-full -rotate-90">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="100%" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="7" />
        <circle
          cx="50" cy="50" r={r} fill="none" stroke={`url(#${id})`} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct / 100)}
          className="transition-[stroke-dashoffset] duration-[1400ms] ease-out"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <span className="block text-4xl font-semibold leading-none tracking-tight">{Math.round(pct)}</span>
          {caption && <span className="mt-1 block text-[10px] uppercase tracking-widest text-muted">{caption}</span>}
        </div>
      </div>
    </div>
  );
}
