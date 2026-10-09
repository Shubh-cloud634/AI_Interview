'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Briefcase, FileText, History, LayoutDashboard, LogOut, Mic, Settings, User } from 'lucide-react';
import { cn } from '@/lib/cn';
import { authConfigured, supabase } from '@/lib/supabase';
import { Logo } from '@/components/layout/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { CardSkeleton } from '@/components/ui/states';
import { RouteBackdrop } from '@/components/three/scene-backdrop';
import { PageTransition } from '@/components/motion/page-transition';

const nav = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/resume', label: 'Resume', icon: FileText },
  { href: '/profile', label: 'Profile', icon: User },
  { href: '/interview/setup', label: 'Practice', icon: Mic },
  { href: '/careers', label: 'Careers', icon: Briefcase },
  { href: '/history', label: 'Progress', icon: History },
  { href: '/settings', label: 'Settings', icon: Settings },
];

const mobileNav = nav.filter((n) => ['/dashboard', '/resume', '/interview/setup', '/careers', '/history'].includes(n.href));

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [ready, setReady] = useState(false);
  const qc = useQueryClient();
  const userId = useRef<string | null>(null);

  useEffect(() => {
    if (!authConfigured()) {
      router.replace('/login');
      return;
    }
    const auth = supabase().auth;
    // Cached data belongs to one account. Drop it whenever the signed-in user changes or leaves.
    const track = (id: string | null) => {
      if (userId.current !== null && userId.current !== id) qc.clear();
      userId.current = id;
    };
    auth.getSession().then(({ data }) => {
      track(data.session?.user.id ?? null);
      return data.session ? setReady(true) : router.replace('/login');
    });
    const { data } = auth.onAuthStateChange((_e, s) => {
      track(s?.user.id ?? null);
      if (!s) router.replace('/login');
    });
    return () => data.subscription.unsubscribe();
  }, [router, qc]);

  // The live interview rooms use the full viewport.
  const immersive = /^\/session\/[^/]+$/.test(path);

  if (!ready) {
    return <div className="mx-auto max-w-3xl p-8"><CardSkeleton lines={4} /></div>;
  }
  if (immersive) return <><RouteBackdrop className="opacity-40" />{children}</>;

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[248px_1fr]">
      <RouteBackdrop className="opacity-50" />
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-border bg-bg/40 p-4 backdrop-blur-xl md:flex">
        <Link href="/dashboard" className="mb-8 px-3 pt-2"><Logo /></Link>
        <nav aria-label="Main" className="flex-1 space-y-1">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = path === href || path.startsWith(href + '/');
            return (
              <Link key={href} href={href} aria-current={active ? 'page' : undefined}
                className={cn('group relative flex items-center gap-3 rounded-full px-3.5 py-2.5 text-sm transition',
                  active ? 'bg-surface-2 font-medium text-fg shadow-[inset_0_0_0_1px_var(--border)]' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
                <Icon size={17} aria-hidden className={active ? 'text-accent-2' : ''} /> {label}
              </Link>
            );
          })}
        </nav>
        <div className="flex flex-col items-stretch gap-1 border-t border-border pt-3">
          <ThemeToggle withLabel className="w-full justify-start" />
          <button className="flex h-9 items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-sm text-muted transition hover:bg-surface-2 hover:text-fg" onClick={() => supabase().auth.signOut()}>
            <LogOut size={16} aria-hidden /> Sign out
          </button>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-bg/70 px-4 py-3 backdrop-blur-xl md:hidden">
          <Logo />
          <div className="flex items-center">
            <Link href="/profile" aria-label="Profile" className="grid size-9 place-items-center rounded-full text-muted hover:bg-surface-2"><User size={17} aria-hidden /></Link>
            <Link href="/settings" aria-label="Settings" className="grid size-9 place-items-center rounded-full text-muted hover:bg-surface-2"><Settings size={17} aria-hidden /></Link>
            <ThemeToggle />
            <button aria-label="Sign out" className="grid size-9 place-items-center rounded-full text-muted hover:bg-surface-2" onClick={() => supabase().auth.signOut()}><LogOut size={17} aria-hidden /></button>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-6xl px-4 pb-28 pt-6 md:px-10 md:py-12 md:pb-12"><PageTransition>{children}</PageTransition></main>
        <nav aria-label="Main" className="glass fixed inset-x-3 bottom-3 z-30 flex justify-around rounded-full px-2 py-1.5 md:hidden">
          {mobileNav.map(({ href, label, icon: Icon }) => {
            const active = path === href || path.startsWith(href + '/');
            return (
              <Link key={href} href={href} aria-current={active ? 'page' : undefined}
                className={cn('flex min-w-14 flex-col items-center gap-0.5 rounded-full px-3 py-1.5 text-[10.5px] transition', active ? 'bg-surface-2 text-fg' : 'text-muted')}>
                <Icon size={18} aria-hidden className={active ? 'text-accent-2' : ''} /> {label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
