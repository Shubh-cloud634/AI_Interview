import { cn } from '@/lib/cn';
import type { InputHTMLAttributes, ReactNode } from 'react';

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[13px] font-medium text-muted">{label}</span>
      {children}
      {error && (
        <span role="alert" className="block text-sm text-bad">
          {error}
        </span>
      )}
    </label>
  );
}

export const inputClass =
  'h-11 w-full rounded-xl border border-border bg-surface-2 px-3.5 text-sm placeholder:text-muted/70 transition focus:border-accent focus:bg-surface';

export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => (
  <input className={cn(inputClass, className)} {...p} />
);
