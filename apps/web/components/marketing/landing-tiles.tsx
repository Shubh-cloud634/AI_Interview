import { ArrowUpRight, Clock } from 'lucide-react';

/** Pure-markup tile bodies for the hero mosaic. Sizes use container units (cqw) so they scale with the column. */

const bars = [0.35, 0.6, 0.9, 0.5, 1, 0.7, 0.4, 0.85, 0.55, 0.95, 0.45];
const big = '[font-family:var(--font-archivo),var(--font-display)]';
const kicker = 'text-[6.5cqw] font-semibold uppercase tracking-[0.14em]';

export function WaveTile() {
  return (
    <div className="flex h-full flex-col justify-between">
      <p className={kicker}>Live interviewer</p>
      <div className="flex h-[38cqw] items-center justify-between">
        {bars.map((b, i) => (
          <span key={i} className="lm-bar w-[5.5cqw] rounded-full bg-current" style={{ height: `${b * 100}%`, animationDelay: `${i * 90}ms` }} />
        ))}
      </div>
      <p className={`text-[8cqw] font-black uppercase leading-[0.95] tracking-tight ${big}`}>Speaks.<br />Listens.</p>
    </div>
  );
}

export function QuestionTile({ n = 3 }: { n?: number }) {
  return (
    <div className="flex h-full flex-col justify-between">
      <p className="flex items-center gap-[2.5cqw] text-[6cqw] font-semibold uppercase tracking-[0.14em] text-[#6b6355]">
        <span className="size-[3cqw] rounded-full bg-[var(--t-coral)]" /> Question {n}
      </p>
      <p className="text-[9cqw] font-semibold leading-[1.15] tracking-tight">Walk me through how you would find the cause of a 20% profit drop.</p>
      <p className="text-[6cqw] text-[#6b6355]">Follow-up adapts to your answer</p>
    </div>
  );
}

export function ScoreTile({ value = 74 }: { value?: number }) {
  const c = 2 * Math.PI * 16;
  return (
    <div className="flex h-full flex-col items-start justify-between">
      <p className={`${kicker} opacity-70`}>Readiness</p>
      <div className="relative mx-auto size-[56cqw]">
        <svg viewBox="0 0 40 40" className="size-full -rotate-90">
          <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeOpacity=".16" strokeWidth="3.4" />
          <circle cx="20" cy="20" r="16" fill="none" stroke="var(--t-coral)" strokeWidth="3.4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} />
        </svg>
        <span className={`absolute inset-0 grid place-items-center text-[17cqw] font-black ${big}`}>{value}</span>
      </div>
      <p className="text-[6cqw] opacity-70">Every score cites your own words</p>
    </div>
  );
}

export function RoleTile() {
  return (
    <div className="flex h-full flex-col justify-between">
      <p className={kicker}>Role match</p>
      <div>
        <p className={`text-[19cqw] font-black leading-none tracking-tight ${big}`}>82%</p>
        <p className="mt-[3cqw] text-[8cqw] font-semibold leading-tight">Data Analyst</p>
      </div>
      <span className="flex w-fit items-center gap-[2cqw] rounded-full bg-[var(--t-ink)] px-[4.5cqw] py-[2.2cqw] text-[6cqw] font-medium text-[var(--t-lime)]">
        Strong match <ArrowUpRight className="size-[6cqw]" aria-hidden />
      </span>
    </div>
  );
}

const code = ['def two_sum(nums, t):', '  seen = {}', '  for i, n in enumerate(nums):', '    if t - n in seen:', '      return [seen[t - n], i]', '    seen[n] = i'].join('\n');

export function CodeTile() {
  return (
    <div className="flex h-full flex-col justify-between">
      <p className="text-[6cqw] font-semibold uppercase tracking-[0.14em] opacity-60">Live coding · sandboxed</p>
      <pre className="font-mono text-[6.2cqw] leading-[1.5] text-[#ffd9cc]">{code}</pre>
      <p className="flex items-center gap-[2cqw] text-[6cqw]"><span className="size-[3cqw] rounded-full bg-[var(--t-lime)]" /> 12 / 12 tests passing</p>
    </div>
  );
}

export function StatTile({ value, label, note }: { value: string; label: string; note: string }) {
  return (
    <div className="flex h-full flex-col justify-between">
      <p className={kicker}>{label}</p>
      <p className={`text-[24cqw] font-black leading-[0.85] tracking-[-0.05em] ${big}`}>{value}</p>
      <p className="text-[7cqw] font-medium leading-tight">{note}</p>
    </div>
  );
}

export function TimerTile() {
  return (
    <div className="flex h-full flex-col justify-between">
      <Clock className="size-[12cqw]" aria-hidden />
      <p className={`text-[17cqw] font-black uppercase leading-[0.9] tracking-[-0.04em] ${big}`}>30 to<br />40 min</p>
      <p className="text-[6.5cqw] font-medium">Leave any time. Answers are kept.</p>
    </div>
  );
}

export function FeedbackTile() {
  return (
    <div className="flex h-full flex-col justify-between">
      <p className="text-[6cqw] font-semibold uppercase tracking-[0.14em] text-[#6b6355]">Evidence</p>
      <blockquote className="text-[8.4cqw] font-medium leading-[1.2]">&ldquo;I compared the margin by region and found one outlier.&rdquo;</blockquote>
      <p className="w-fit rounded-full bg-[var(--t-lime)] px-[4cqw] py-[1.8cqw] text-[6cqw] font-semibold">Structured analysis · 4/5</p>
    </div>
  );
}
