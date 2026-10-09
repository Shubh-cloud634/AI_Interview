import { cn } from '@/lib/cn';
import { AlertTriangle, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './button';
import { ApiError } from '@/lib/api/client';

export const Skeleton = ({ className }: { className?: string }) => (
  <div aria-hidden className={cn('skeleton h-4 w-full', className)} />
);

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div role="status" aria-label="Loading" className="glass space-y-3 rounded-[var(--radius)] p-6">
      <Skeleton className="h-5 w-1/3" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={i === lines - 1 ? 'w-2/3' : ''} />
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const api = error instanceof ApiError ? error : null;
  const unreachable = api?.status === 0;
  return (
    <div role="alert" className="glass rounded-[var(--radius)] border-bad/30 p-8 text-center">
      <span className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-bad/10"><AlertTriangle className="text-bad" size={20} aria-hidden /></span>
      <p className="font-medium">{unreachable ? 'Cannot reach the server' : (api?.title ?? 'Something went wrong')}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
        {unreachable ? 'Check your connection and that the API is running.' : (api?.detail ?? 'Please try again.')}
      </p>
      {onRetry && (
        <Button className="mt-4" variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius)] border border-dashed border-border-strong p-10 text-center">
      <span className="mx-auto mb-3 grid size-11 place-items-center rounded-full bg-accent-soft"><Sparkles className="text-accent" size={20} aria-hidden /></span>
      <p className="font-medium">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
