import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { Logo } from '@/components/layout/logo';
import { SceneBackdrop } from '@/components/three/scene-backdrop';

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="relative grid min-h-dvh lg:grid-cols-2">
      <main id="main" className="relative z-10 grid place-items-center px-5 pb-10 pt-24">
        <Link href="/" className="absolute left-4 top-4 inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface-2 py-2 pl-3 pr-4 text-sm font-medium text-muted transition hover:border-border-strong hover:text-fg active:scale-95">
          <ArrowLeft size={16} aria-hidden /> Back to home
        </Link>
        <div className="absolute right-4 top-4 lg:hidden"><ThemeToggle /></div>
        <div className="rise w-full max-w-sm">
          <Link href="/" className="mb-10 inline-block"><Logo /></Link>
          <h1 className="display text-4xl">{title}</h1>
          <p className="mb-8 mt-3 text-muted">{subtitle}</p>
          {children}
        </div>
      </main>
      <aside aria-hidden className="relative hidden items-center justify-center overflow-hidden border-l border-border lg:flex">
        <div className="absolute right-4 top-4 z-10"><ThemeToggle /></div>
        <SceneBackdrop variant="hero" className="!absolute !-z-0 opacity-90" />
      </aside>
    </div>
  );
}
