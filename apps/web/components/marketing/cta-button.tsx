'use client';

import Link from 'next/link';
import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';

const MotionLink = motion.create(Link);

/**
 * The primary call to action: a cream pill with a coral arrow disc. The whole pill is the link.
 * Sized from its content (padding, not a fixed height) and `shrink-0 whitespace-nowrap`, so a tight flex
 * parent can never squeeze the disc into an oval or wrap the label. `className` sets the display (default inline-flex),
 * so a caller can pass `hidden sm:inline-flex` without the two display classes fighting.
 */
export function CtaLink({ href = '/register', children = 'Start interview', size = 'md', className = 'inline-flex', onClick }: { href?: string; children?: ReactNode; size?: 'md' | 'lg'; className?: string; onClick?: () => void }) {
  const lg = size === 'lg';
  return (
    <MotionLink
      href={href}
      onClick={onClick}
      initial="rest"
      animate="rest"
      whileHover="hover"
      whileTap="tap"
      variants={{ rest: { y: 0, scale: 1 }, hover: { y: -2, scale: 1 }, tap: { y: 0, scale: 0.97 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 28 }}
      className={`shrink-0 select-none items-center gap-3 whitespace-nowrap rounded-full bg-fg font-semibold text-bg shadow-[0_10px_30px_-12px_var(--glow-a)] ${lg ? 'py-1.5 pl-7 pr-1.5 text-base' : 'py-1 pl-5 pr-1 text-sm'} ${className}`}
    >
      <span>{children}</span>
      <motion.span
        aria-hidden
        variants={{ rest: { x: 0, rotate: 0 }, hover: { x: 2, rotate: -45 }, tap: { x: 0, rotate: -45 } }}
        className={`grid shrink-0 place-items-center rounded-full bg-accent text-accent-fg ${lg ? 'size-12' : 'size-9'}`}
      >
        <ArrowRight size={lg ? 20 : 16} />
      </motion.span>
    </MotionLink>
  );
}
