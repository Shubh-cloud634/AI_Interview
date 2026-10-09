'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';

/** Switches light and dark. The choice is saved by next-themes, so it follows you to every page. */
export function ThemeToggle({ withLabel = false, className }: { withLabel?: boolean; className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = !mounted || resolvedTheme === 'dark';
  const Icon = dark ? Sun : Moon;
  const next = dark ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className={cn(
        'inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-full border border-border bg-surface-2 text-sm text-muted transition hover:border-border-strong hover:text-fg active:scale-95',
        withLabel ? 'px-3.5' : 'w-9',
        className,
      )}
    >
      <Icon size={16} aria-hidden />
      {withLabel && <span>{dark ? 'Light mode' : 'Dark mode'}</span>}
    </button>
  );
}
