import { cn } from '@/lib/cn';
import Link from 'next/link';
import type { ButtonHTMLAttributes, ComponentProps } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition duration-200 active:scale-[.97] disabled:opacity-50 disabled:pointer-events-none';
const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-fg shadow-[0_10px_30px_-10px_var(--glow-a)] hover:shadow-[0_16px_44px_-8px_var(--glow-a)] hover:-translate-y-0.5 hover:brightness-110',
  secondary: 'glass text-fg hover:border-border-strong hover:bg-surface-2',
  ghost: 'text-muted hover:bg-surface-2 hover:text-fg',
  danger: 'bg-bad/15 text-bad border border-bad/40 hover:bg-bad/25',
};
const sizes: Record<Size, string> = { sm: 'h-8 px-3.5 text-[13px]', md: 'h-10 px-5 text-sm', lg: 'h-12 px-7 text-[15px]' };

type Style = { variant?: Variant; size?: Size };

export function Button({ variant = 'primary', size = 'md', className, ...p }: Style & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={cn(base, variants[variant], sizes[size], className)} {...p} />;
}

export function ButtonLink({ variant = 'primary', size = 'md', className, ...p }: Style & ComponentProps<typeof Link>) {
  return <Link className={cn(base, variants[variant], sizes[size], className)} {...p} />;
}
