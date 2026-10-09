export type RadarPoint = { label: string; value: number };

export function Radar({ points, max = 100, size = 300 }: { points: RadarPoint[]; max?: number; size?: number }) {
  const n = points.length;
  if (n < 3) return <p className="text-sm text-muted">Not enough competencies to chart yet.</p>;
  const c = size / 2;
  const r = c - 68;
  const at = (i: number, k: number) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [c + Math.cos(a) * r * k, c + Math.sin(a) * r * k] as const;
  };
  const poly = points.map((p, i) => at(i, Math.max(0, Math.min(1, p.value / max))).join(',')).join(' ');
  const summary = points.map((p) => `${p.label} ${Math.round(p.value)}`).join(', ');
  return (
    <svg viewBox={`-50 0 ${size + 100} ${size}`} role="img" aria-label={`Skill radar: ${summary}`} className="mx-auto w-full max-w-sm">
      <defs>
        <radialGradient id="radar-fill" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="var(--accent-2)" stopOpacity=".35" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity=".18" />
        </radialGradient>
      </defs>
      {[0.25, 0.5, 0.75, 1].map((k) => (
        <polygon key={k} points={points.map((_, i) => at(i, k).join(',')).join(' ')} fill="none" stroke="var(--border)" strokeDasharray={k === 1 ? undefined : '2 4'} />
      ))}
      {points.map((p, i) => {
        const [x, y] = at(i, 1);
        return <line key={p.label} x1={c} y1={c} x2={x} y2={y} stroke="var(--border)" />;
      })}
      <polygon points={poly} fill="url(#radar-fill)" stroke="var(--accent)" strokeWidth="1.75" strokeLinejoin="round" />
      {points.map((p, i) => {
        const [x, y] = at(i, Math.max(0, Math.min(1, p.value / max)));
        return <circle key={p.label} cx={x} cy={y} r="3" fill="var(--bg)" stroke="var(--accent-2)" strokeWidth="1.5" />;
      })}
      {points.map((p, i) => {
        const [x, y] = at(i, 1.2);
        return (
          <text
            key={p.label} x={x} y={y} fontSize="12" fill="var(--muted)"
            textAnchor={x < c - 4 ? 'end' : x > c + 4 ? 'start' : 'middle'} dominantBaseline="middle"
          >
            {p.label.length > 16 ? `${p.label.slice(0, 15)}…` : p.label}
          </text>
        );
      })}
    </svg>
  );
}
