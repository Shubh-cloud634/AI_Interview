import Link from 'next/link';
import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { Logo } from '@/components/layout/logo';
import { SceneBackdrop } from '@/components/three/scene-backdrop';

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="relative grid min-h-dvh lg:grid-cols-2">
      <main id="main" className="relative z-10 grid place-items-center px-5 py-10">
        <div className="absolute right-4 top-4 lg:hidden"><ThemeToggle /></div>
        <div className="rise w-full max-w-sm">
          <Link href="/" className="mb-10 inline-block"><Logo /></Link>
          <h1 className="display text-4xl">{title}</h1>
          <p className="mb-8 mt-3 text-muted">{subtitle}</p>
          {children}
        </div>
      </main>
      <aside aria-hidden className="relative hidden items-center justify-center overflow-hidden border-l border-border lg:flex">
                <div className="absolute right-4 top-4"><ThemeToggle /></div>
        <SceneBackdrop variant="hero" className="!absolute !-z-0 opacity-90" />
      </aside>
    </div>
  );
}
