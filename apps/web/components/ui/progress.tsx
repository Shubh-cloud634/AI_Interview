import { cn } from '@/lib/cn';

export function Progress({ value, label, className }: { value: number; label: string; className?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-2', className)}
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2 transition-[width] duration-1000 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
