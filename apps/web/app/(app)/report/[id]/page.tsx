'use client';

import { useParams } from 'next/navigation';
import { AlertCircle, ArrowRight, CheckCircle2, Loader2 } from 'lucide-react';
import { Async } from '@/components/async';
import { Badge } from '@/components/ui/badge';
import { Card, CardTitle, Eyebrow } from '@/components/ui/card';
import { ButtonLink } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Radar } from '@/components/ui/radar';
import { ScoreRing } from '@/components/ui/score-ring';
import { TrendLine } from '@/components/ui/trend-line';
import { kindMeta } from '@/lib/kinds';
import { useReport } from '@/lib/api/hooks';
import { pct, shortDate } from '@/lib/format';
import { label, readinessLevel } from '@/lib/insights';

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const report = useReport(id);
  return (
    <Async query={report}>
      {(r) => {
        if (r === null) return <Card className="flex items-center gap-3" role="status"><Loader2 className="animate-spin text-accent" aria-hidden /> Building your report. This usually takes under a minute.</Card>;
        const b = r.body;
        const overall = b.overall === null ? null : b.overall * 100;
        const level = readinessLevel(overall);
        const lowest = [...b.competencies].sort((a, c) => a.score - c.score)[0];
        return (
          <div className="space-y-6">
            <section className="glass noise rise relative overflow-hidden rounded-[22px] p-6 md:p-10" aria-labelledby="report-h">
              <div aria-hidden className="grid-lines absolute inset-0 opacity-50" />
              <div className="relative grid items-center gap-8 md:grid-cols-[auto_1fr]">
                <div className="flex flex-col items-center gap-3">
                  {overall === null ? <p className="grid size-40 place-items-center rounded-full border border-dashed border-border-strong text-sm text-muted">Not scored</p> : <ScoreRing className="size-40" value={overall} label="Overall score" caption="out of 100" />}
                  <div className="flex flex-wrap justify-center gap-2"><Badge tone={level.tone}>{level.label}</Badge>{b.lowConfidence && <Badge tone="warn"><AlertCircle size={12} aria-hidden /> Lower confidence</Badge>}</div>
                </div>
                <div>
                  <Eyebrow>Performance report · {shortDate(r.renderedAt)}</Eyebrow>
                  <h1 id="report-h" className="display mt-3 text-3xl md:text-5xl">{b.headline}</h1>
                  <p className="mt-5 max-w-2xl whitespace-pre-wrap text-pretty leading-relaxed text-muted">{b.narrative}</p>
                  {b.nextPractice && <ButtonLink className="mt-6" href={`/interview/setup?mode=${b.nextPractice.modeId}`}>Practise next: {b.nextPractice.name} <ArrowRight size={16} aria-hidden /></ButtonLink>}
                </div>
              </div>
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardTitle className="mb-4">Competency profile</CardTitle>
                <Radar points={b.competencies.map((c) => ({ label: c.name, value: c.score * 100 }))} />
              </Card>
              <Card>
                <CardTitle className="mb-5">Category scores</CardTitle>
                <ul className="space-y-4">
                  {b.competencies.map((c) => (
                    <li key={c.competencyId}>
                      <div className="mb-1.5 flex justify-between text-sm"><span>{c.name}</span><span className="tabular-nums">{pct(c.score)}</span></div>
                      <Progress label={c.name} value={c.score * 100} />
                    </li>
                  ))}
                </ul>
              </Card>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardTitle className="mb-4 text-good">Strengths</CardTitle>
                {b.strengths.length ? <ul className="space-y-3">{b.strengths.map((s) => <li key={s.competencyId} className="flex items-center gap-3 text-sm"><CheckCircle2 size={16} className="shrink-0 text-good" aria-hidden /><span className="flex-1">{s.name}</span><span className="tabular-nums text-muted">{pct(s.score)}</span></li>)}</ul> : <p className="text-sm text-muted">None clearly identified yet.</p>}
              </Card>
              <Card>
                <CardTitle className="mb-4 text-warn">To work on</CardTitle>
                {b.gaps.length ? <ul className="space-y-3">{b.gaps.map((s) => <li key={s.competencyId} className="flex items-center gap-3 text-sm"><AlertCircle size={16} className="shrink-0 text-warn" aria-hidden /><span className="flex-1">{s.name}</span><span className="tabular-nums text-muted">{pct(s.score)}</span></li>)}</ul> : <p className="text-sm text-muted">No clear gaps. Try a harder format.</p>}
              </Card>
            </div>

            <Card>
              <CardTitle className="mb-6">Interview timeline</CardTitle>
              <ol className="relative grid gap-4 md:grid-flow-col md:auto-cols-fr">
                {b.stages.map((s, i) => {
                  const Icon = kindMeta[s.kind].icon;
                  return (
                    <li key={s.stageId} className="relative rounded-2xl border border-border bg-surface-2 p-4">
                      <div className="mb-3 flex items-center justify-between"><span className="grid size-8 place-items-center rounded-full bg-accent-soft text-accent"><Icon size={15} aria-hidden /></span><span className="font-mono text-xs text-muted">{String(i + 1).padStart(2, '0')}</span></div>
                      <p className="font-medium capitalize">{label(s.stageId)}</p>
                      <p className="text-xs text-muted">{kindMeta[s.kind].label} · {pct(s.weight)}% weight</p>
                      <p className="mt-3 text-2xl font-semibold tabular-nums">{s.score === null ? <span className="text-sm font-normal text-muted">{s.status === 'skipped' ? 'Skipped' : 'Not scored'}</span> : pct(s.score)}</p>
                      {s.lowConfidence && <p className="mt-1 text-xs text-warn">Lower confidence</p>}
                    </li>
                  );
                })}
              </ol>
            </Card>

            <Card>
              <CardTitle className="mb-1">Evidence from your answers</CardTitle>
              <p className="mb-6 text-sm text-muted">Every score points back to something you said.{lowest ? ` Weakest area: ${lowest.name}.` : ''}</p>
              <ul className="space-y-8">
                {b.competencies.map((c) => (
                  <li key={c.competencyId}>
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm font-medium"><span>{c.name}</span><span className="tabular-nums">{pct(c.score)}<span className="ml-2 font-normal text-muted">confidence {pct(c.confidence)}%</span></span></div>
                    <Progress label={c.name} value={c.score * 100} />
                    {c.evidence.length === 0 ? <p className="mt-3 text-sm text-muted">No quotable evidence for this area.</p> : (
                      <ul className="mt-4 space-y-3">
                        {c.evidence.map((ev, i) => (
                          <li key={i} className="border-l-2 border-accent-2/60 pl-4 text-sm"><q className="italic">{ev.quote}</q><span className="mt-0.5 block text-xs text-muted">{ev.criterion} · {label(ev.stageId)}</span></li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </Card>

            {b.trend.length > 1 && (
              <Card><CardTitle className="mb-4">Your trend</CardTitle><TrendLine points={b.trend.map((t) => ({ x: t.finishedAt, y: t.overall }))} height={190} /></Card>
            )}
          </div>
        );
      }}
    </Async>
  );
}
