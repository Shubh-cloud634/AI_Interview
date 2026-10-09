/** Rehearse mark: a ring (the room) around a rising waveform (the conversation). */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 text-[17px] font-semibold tracking-tight ${className}`}>
      <svg width="26" height="26" viewBox="0 0 28 28" aria-hidden>
        <defs>
          <linearGradient id="logo-g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="28" y2="28">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="100%" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>
        <circle cx="14" cy="14" r="12.25" fill="none" stroke="url(#logo-g)" strokeWidth="1.5" />
        <g stroke="url(#logo-g)" strokeWidth="2" strokeLinecap="round">
          <line x1="9" y1="16" x2="9" y2="12" />
          <line x1="12.5" y1="19" x2="12.5" y2="9" />
          <line x1="16" y1="17" x2="16" y2="11" />
          <line x1="19.5" y1="15" x2="19.5" y2="13" />
        </g>
      </svg>
      Rehearse
    </span>
  );
}
