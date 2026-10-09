'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowUpRight, TrendingDown, TrendingUp } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Async } from '@/components/async';
import { Badge } from '@/components/ui/badge';
import { Card, CardTitle } from '@/components/ui/card';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/states';
import { Progress } from '@/components/ui/progress';
import { inputClass } from '@/components/ui/field';
import { TrendLine } from '@/components/ui/trend-line';
import { useDomains, useHistory, useRecommendations, useTrends } from '@/lib/api/hooks';
import { pct, shortDate } from '@/lib/format';
import { label } from '@/lib/insights';

export default function HistoryPage() {
  const [domain, setDomain] = useState('');
  const domains = useDomains();
  const history = useHistory({ domain: domain || undefined });
  const trends = useTrends();
  const recs = useRecommendations();

  const points = trends.data?.points ?? [];
  const insight = useMemo(() => {
    if (points.length < 2) return null;
    const recent = points.slice(-4);
    const from = recent[0]!.score, to = recent[recent.length - 1]!.score;
    return { from: Math.round(from * 100), to: Math.round(to * 100), n: recent.length, up: to >= from };
  }, [points]);

  // Gaps that keep showing up across sessions are the real weak areas.
  const recurring = useMemo(() => {
    const counts = new Map<string, { name: string; n: number; sum: number }>();
    for (const s of history.data?.items ?? []) for (const g of s.topGaps) {
      const c = counts.get(g.competencyId) ?? { name: g.name, n: 0, sum: 0 };
      counts.set(g.competencyId, { name: g.name, n: c.n + 1, sum: c.sum + g.score });
    }
    return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 4);
  }, [history.data]);

  return (
    <>
      <PageHeader eyebrow="Progress" title="See yourself improve." subtitle="Every finished interview, and how your scores are moving over time." />

      {insight && (
        <div className="glass rise mb-6 flex flex-wrap items-center gap-4 rounded-[var(--radius)] p-5 md:p-6">
          <span className={`grid size-11 place-items-center rounded-full ${insight.up ? 'bg-good/15 text-good' : 'bg-warn/15 text-warn'}`}>{insight.up ? <TrendingUp size={20} aria-hidden /> : <TrendingDown size={20} aria-hidden />}</span>
          <p className="text-lg">
            Overall {insight.up ? 'improved' : 'moved'} from <strong>{insight.from}</strong> → <strong>{insight.to}</strong> across your last {insight.n} interviews.
          </p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardTitle className="mb-4">Score history</CardTitle>
          <Async query={trends}>
            {() => points.length > 1 ? <TrendLine points={points.map((p) => ({ x: p.finishedAt, y: p.score }))} height={210} /> : <p className="py-10 text-center text-sm text-muted">Finish two interviews to see your trend.</p>}
          </Async>
        </Card>
        <Card>
          <CardTitle className="mb-4">Recurring weak areas</CardTitle>
          {recurring.length === 0 ? <p className="text-sm text-muted">Nothing recurring yet.</p> : (
            <ul className="space-y-4">
              {recurring.map((g) => (
                <li key={g.name}>
                  <div className="mb-1.5 flex justify-between text-sm"><span>{g.name}</span><span className="text-muted">in {g.n} session{g.n > 1 ? 's' : ''}</span></div>
                  <Progress label={g.name} value={(g.sum / g.n) * 100} />
                </li>
              ))}
            </ul>
          )}
          <Async query={recs} skeleton={null}>
            {(r) => r.nextMode ? <ButtonLink className="mt-6" size="sm" variant="secondary" href={`/interview/setup?mode=${r.nextMode.modeId}`}>Practise: {r.nextMode.name}</ButtonLink> : null}
          </Async>
        </Card>
      </div>

      <div className="mb-4 mt-10 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl">Past interviews</h2>
        <div>
          <label className="sr-only" htmlFor="domain">Filter by domain</label>
          <select id="domain" className={`${inputClass} w-auto min-w-44`} value={domain} onChange={(e) => setDomain(e.target.value)}>
            <option value="">All domains</option>
            {domains.data?.items.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      </div>
      <Async query={history}>
        {(h) =>
          h.items.length === 0 ? (
            <EmptyState title="No interviews found" action={<ButtonLink href="/interview/setup">Start an interview</ButtonLink>} />
          ) : (
            <ul className="space-y-3">
              {h.items.map((s, i) => {
                const prev = h.items[i + 1];
                const delta = s.overall !== null && prev?.overall != null ? Math.round((s.overall - prev.overall) * 100) : null;
                return (
                  <li key={s.sessionId}>
                    <Link href={`/report/${s.sessionId}`} className="block">
                      <Card className="glass-hover flex flex-wrap items-center justify-between gap-3 p-5 md:p-5">
                        <div className="min-w-0">
                          <p className="font-medium capitalize">{label(s.modeSlug)}</p>
                          <p className="text-sm text-muted">{shortDate(s.finishedAt)}{s.topGaps[0] ? ` · work on ${s.topGaps[0].name}` : ''}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          {delta !== null && delta !== 0 && <Badge tone={delta > 0 ? 'good' : 'warn'}>{delta > 0 ? '+' : ''}{delta}</Badge>}
                          <span className="text-2xl font-semibold tabular-nums">{s.overall === null ? 'Unscored' : pct(s.overall)}</span>
                          <ArrowUpRight size={16} className="text-muted" aria-hidden />
                        </div>
                      </Card>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )
        }
      </Async>
    </>
  );
}
