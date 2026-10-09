'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Check, Clock, DoorOpen, Loader2, Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Async } from '@/components/async';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ErrorState, CardSkeleton } from '@/components/ui/states';
import { Field, inputClass } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { kindMeta } from '@/lib/kinds';
import { label } from '@/lib/insights';
import { pct } from '@/lib/format';
import { useCreateSession, useDomains, useModeDetail, useModes, useRecommendations, useRoles } from '@/lib/api/hooks';

export default function Page() {
  return <Suspense fallback={<CardSkeleton lines={5} />}><Setup /></Suspense>;
}

function Setup() {
  const router = useRouter();
  const preset = useSearchParams().get('mode') ?? undefined;
  const [domainId, setDomainId] = useState<string>();
  const [roleId, setRoleId] = useState<string>('');
  const [modeId, setModeId] = useState<string | undefined>(preset);

  const domains = useDomains();
  const roles = useRoles(domainId);
  const modes = useModes(domainId);
  const detail = useModeDetail(modeId);
  const recs = useRecommendations();
  const create = useCreateSession();

  useEffect(() => {
    if (detail.data) setDomainId(detail.data.domainId);
  }, [detail.data]);

  // With a single published domain there is nothing to choose, so skip the step.
  useEffect(() => {
    if (!domainId && domains.data?.items.length === 1) setDomainId(domains.data.items[0]!.id);
  }, [domains.data, domainId]);

  function start() {
    if (!modeId) return;
    create.mutate({ modeId, targetRoleId: roleId || undefined }, { onSuccess: (s) => router.push(`/session/${s.id}`) });
  }

  const totalSec = detail.data?.spec.stages.reduce((n, s) => n + (s.timeLimitSec ?? 0), 0) ?? 0;

  return (
    <>
      <PageHeader eyebrow="Interview setup" title="Set up your interview." subtitle="Pick a career domain, a target role and a format. Sessions run 30 to 40 minutes and you can leave at any point." />

      <Async query={recs} skeleton={null}>
        {(r) =>
          r.nextMode ? (
            <div className="glass mb-6 flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius)] border-accent/40 p-5">
              <p className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-full bg-accent-soft"><Sparkles size={17} className="text-accent" aria-hidden /></span>
                <span>Recommended for you: <strong>{r.nextMode.name}</strong>{r.gaps[0] && <span className="block text-sm text-muted">Targets your gap in {r.gaps[0].name}</span>}</span></p>
              <Button size="sm" onClick={() => setModeId(r.nextMode!.modeId)}>Use this</Button>
            </div>
          ) : null
        }
      </Async>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <CardTitle className="mb-5"><span className="mr-2 font-mono text-accent-2">01</span>Domain and role</CardTitle>
            <Async query={domains}>
              {(d) => (
                <div className="space-y-5">
                  <div role="radiogroup" aria-label="Career domain" className="flex flex-wrap gap-2">
                    {d.items.map((x) => (
                      <button key={x.id} type="button" role="radio" aria-checked={domainId === x.id}
                        onClick={() => { setDomainId(x.id); setRoleId(''); setModeId(undefined); }}
                        className={cn('rounded-full border px-4 py-2 text-sm transition', domainId === x.id ? 'border-accent bg-accent-soft text-fg' : 'border-border text-muted hover:border-border-strong hover:text-fg')}>
                        {x.name}
                      </button>
                    ))}
                  </div>
                  <Field label="Target role (optional)">
                    <select className={inputClass} value={roleId} disabled={!domainId || roles.isPending} onChange={(e) => setRoleId(e.target.value)}>
                      <option value="">Any role</option>
                      {roles.data?.items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  </Field>
                </div>
              )}
            </Async>
          </Card>

          <Card>
            <CardTitle className="mb-5"><span className="mr-2 font-mono text-accent-2">02</span>Interview format</CardTitle>
            {!domainId ? <p className="text-sm text-muted">Choose a domain first.</p> : (
              <Async query={modes}>
                {(m) => m.items.length === 0 ? <p className="text-sm text-muted">No formats are published for this domain yet.</p> : (
                  <ul className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Interview format">
                    {m.items.map((x) => {
                      const kinds = [...new Set(x.stageKinds)];
                      return (
                        <li key={x.id}>
                          <button type="button" role="radio" aria-checked={modeId === x.id} onClick={() => setModeId(x.id)}
                            className={cn('group relative h-full w-full rounded-2xl border p-5 text-left transition',
                              modeId === x.id ? 'border-accent bg-accent-soft shadow-[0_0_40px_-12px_var(--glow-a)]' : 'border-border bg-surface-2 hover:border-border-strong')}>
                            {modeId === x.id && <span className="absolute right-4 top-4 grid size-5 place-items-center rounded-full bg-accent text-accent-fg"><Check size={12} aria-hidden /></span>}
                            <div className="mb-4 flex gap-1.5">
                              {kinds.map((k) => { const Icon = kindMeta[k].icon; return <span key={k} title={kindMeta[k].label} className="grid size-8 place-items-center rounded-lg bg-surface-2 text-accent-2"><Icon size={16} aria-hidden /></span>; })}
                            </div>
                            <p className="font-medium">{x.name}</p>
                            <p className="mt-1 text-xs text-muted">{kinds.map((k) => kindMeta[k].label).join(' · ')}</p>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Async>
            )}
          </Card>
        </div>

        <Card className="h-fit lg:sticky lg:top-8">
          <CardTitle className="mb-5">What to expect</CardTitle>
          {!modeId ? <p className="text-sm text-muted">Pick a format to preview its stages.</p> : (
            <Async query={detail}>
              {(d) => (
                <>
                  <div className="mb-5 flex flex-wrap gap-2">
                    <Badge tone="accent"><Clock size={12} aria-hidden /> About {Math.round(totalSec / 60)} min</Badge>
                    <Badge><DoorOpen size={12} aria-hidden /> Leave any time</Badge>
                  </div>
                  <ol className="space-y-4">
                    {d.spec.stages.map((s, i) => {
                      const Icon = kindMeta[s.kind].icon;
                      return (
                        <li key={s.id} className="flex gap-3 text-sm">
                          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-accent-2"><Icon size={15} aria-hidden /></span>
                          <span>
                            <span className="font-medium capitalize">{i + 1}. {label(s.id)}</span>
                            <span className="block text-xs text-muted">{kindMeta[s.kind].label}{s.timeLimitSec ? ` · ${Math.round(s.timeLimitSec / 60)} min` : ''} · {pct(s.weight)}% of score</span>
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                </>
              )}
            </Async>
          )}
          <Button className="mt-7 w-full" size="lg" disabled={!modeId || create.isPending} onClick={start}>
            {create.isPending ? <><Loader2 className="animate-spin" size={16} aria-hidden /> Preparing…</> : <>Begin interview <ArrowRight size={16} aria-hidden /></>}
          </Button>
          <p className="mt-3 text-center text-xs text-muted">Ending early keeps your answers; unanswered stages are not scored.</p>
          {create.isError && <div className="mt-4"><ErrorState error={create.error} /></div>}
        </Card>
      </div>
    </>
  );
}
