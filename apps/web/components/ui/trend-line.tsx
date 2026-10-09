import { pct, shortDate } from '@/lib/format';

export function TrendLine({ points, height = 170 }: { points: { x: string; y: number }[]; height?: number }) {
  const w = 600, h = height, pad = 26;
  const sorted = [...points].sort((a, b) => a.x.localeCompare(b.x));
  const px = (i: number) => pad + (i / Math.max(1, sorted.length - 1)) * (w - pad * 2);
  const py = (v: number) => h - pad - v * (h - pad * 2);
  const line = sorted.map((p, i) => `${i ? 'L' : 'M'}${px(i)},${py(p.y)}`).join(' ');
  const area = `${line} L${px(sorted.length - 1)},${h - pad} L${px(0)},${h - pad} Z`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`Scores over time: ${sorted.map((p) => `${shortDate(p.x)} ${pct(p.y)}`).join(', ')}`}
      className="w-full overflow-visible"
    >
      <defs>
        <linearGradient id="trend-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity=".32" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="trend-line" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--accent)" />
          <stop offset="100%" stopColor="var(--accent-2)" />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map((v) => (
        <g key={v}>
          <line x1={pad} x2={w - pad} y1={py(v)} y2={py(v)} stroke="var(--border)" strokeDasharray="2 5" />
          <text x={0} y={py(v)} fontSize="9.5" fill="var(--muted)" dominantBaseline="middle">{Math.round(v * 100)}</text>
        </g>
      ))}
      {sorted.length > 1 && <path d={area} fill="url(#trend-area)" />}
      <path d={line} fill="none" stroke="url(#trend-line)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {sorted.map((p, i) => (
        <circle key={i} cx={px(i)} cy={py(p.y)} r={i === sorted.length - 1 ? 5 : 3.5} fill="var(--bg)" stroke="var(--accent-2)" strokeWidth="2" />
      ))}
    </svg>
  );
}
