'use client';

import { useParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Async } from '@/components/async';
import { Card, CardTitle } from '@/components/ui/card';
import { ButtonLink } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScoreRing } from '@/components/ui/score-ring';
import { useEvaluation } from '@/lib/api/hooks';
import { pct } from '@/lib/format';
import { label } from '@/lib/insights';

export default function Results() {
  const { id } = useParams<{ id: string }>();
  const ev = useEvaluation(id);
  return (
    <>
      <PageHeader eyebrow="Session complete" title="Scoring your interview." subtitle="Each stage is scored against its rubric." />
      <Async query={ev}>
        {(e) =>
          e === null || e.status === 'pending' ? (
            <Card className="flex items-center gap-3" role="status"><Loader2 className="animate-spin text-accent" aria-hidden /> Scoring your answers. This usually takes under a minute.</Card>
          ) : e.status === 'failed' ? (
            <Card role="alert">We could not score this session. Your answers are saved.</Card>
          ) : e.overall === null ? (
            <Card role="status" className="space-y-4">
              <p>No answers were scored. Answer at least one question before ending and you will get a score and a report.</p>
              <ButtonLink href="/interview/setup">Start another interview</ButtonLink>
            </Card>
          ) : (
            <div className="space-y-6">
              <Card className="flex flex-wrap items-center gap-8">
                <ScoreRing className="size-40" value={e.overall * 100} label="Overall score" caption="out of 100" />
                <div className="min-w-48 flex-1">
                  <p className="eyebrow">Overall</p>
                  <p className="mt-2 text-5xl font-semibold tracking-tight tabular-nums">{pct(e.overall)}<span className="text-xl text-muted"> / 100</span></p>
                </div>
                <ButtonLink href={`/report/${id}`}>Full performance report</ButtonLink>
              </Card>
              <Card>
                <CardTitle className="mb-5">By stage</CardTitle>
                <ul className="space-y-5">
                  {e.stages.map((s) => (
                    <li key={s.stageId}>
                      <div className="mb-1.5 flex justify-between text-sm"><span className="capitalize">{label(s.stageId)} <span className="text-muted">({s.kind})</span></span><span className="tabular-nums">{s.score === null ? 'Not scored' : pct(s.score)}</span></div>
                      <Progress label={s.stageId} value={(s.score ?? 0) * 100} />
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          )
        }
      </Async>
    </>
  );
}
