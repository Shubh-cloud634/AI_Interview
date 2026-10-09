'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Check, Clock, DoorOpen, FileText, Loader2, Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Async } from '@/components/async';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ErrorState, CardSkeleton } from '@/components/ui/states';
import { Field, inputClass } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { interviewTypes, kindMeta } from '@/lib/kinds';
import { label } from '@/lib/insights';
import { pct } from '@/lib/format';
import { useCreateSession, useDomains, useModeDetail, useModes, useProfile, useRecommendations, useRoles } from '@/lib/api/hooks';

export default function Page() {
  return <Suspense fallback={<CardSkeleton lines={5} />}><Setup /></Suspense>;
}

function Setup() {
  const router = useRouter();
  const params = useSearchParams();
  const preset = params.get('mode') ?? undefined;
  const presetType = params.get('type');
  const [domainId, setDomainId] = useState<string>();
  const [roleId, setRoleId] = useState<string>('');
  const [modeId, setModeId] = useState<string | undefined>(preset);

  const domains = useDomains();
  const roles = useRoles(domainId);
  const modes = useModes(domainId);
  const detail = useModeDetail(modeId);
  const recs = useRecommendations();
  const profile = useProfile();
  const create = useCreateSession();

  useEffect(() => {
    if (detail.data) setDomainId(detail.data.domainId);
  }, [detail.data]);

  // With a single published domain there is nothing to choose, so skip the step.
  useEffect(() => {
    if (!domainId && domains.data?.items.length === 1) setDomainId(domains.data.items[0]!.id);
  }, [domains.data, domainId]);

  const typeSlugs: ReadonlySet<string> = new Set(interviewTypes.map((t) => t.slug));
  const otherModes = modes.data?.items.filter((x) => !typeSlugs.has(x.slug)) ?? [];

  useEffect(() => {
    const wanted = interviewTypes.find((t) => t.id === presetType)?.slug;
    const hit = wanted && modes.data?.items.find((x) => x.slug === wanted);
    if (hit) setModeId((cur) => cur ?? hit.id);
  }, [presetType, modes.data]);

  function start() {
    if (!modeId) return;
    create.mutate({ modeId, targetRoleId: roleId || undefined }, { onSuccess: (s) => router.push(`/session/${s.id}`) });
  }

  const totalSec = detail.data?.spec.stages.reduce((n, s) => n + (s.timeLimitSec ?? 0), 0) ?? 0;

  return (
    <>
      <PageHeader eyebrow="Interview setup" title="Set up your interview." subtitle="Pick a career domain, a target role and a format. Sessions run 30 to 40 minutes and you can leave at any point." />

      {profile.isSuccess && profile.data === null && (
        <div className="glass mb-6 flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius)] p-5">
          <p className="flex items-center gap-3 text-sm"><span className="grid size-9 place-items-center rounded-full bg-accent-soft"><FileText size={17} className="text-accent" aria-hidden /></span>
            <span><strong>Upload your resume first.</strong> <span className="text-muted">Without it the questions are generic. With it, every question is built on your own projects and skills.</span></span></p>
          <Link href="/resume" className="inline-flex h-8 items-center rounded-full bg-fg px-3.5 text-[13px] font-medium text-bg">Upload resume</Link>
        </div>
      )}

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
            <CardTitle className="mb-1"><span className="mr-2 font-mono text-accent-2">02</span>What type of interview do you want?</CardTitle>
            <p className="mb-5 text-sm text-muted">We build the questions around your resume for the type you choose.</p>
            {!domainId ? <p className="text-sm text-muted">Choose a domain first.</p> : (
              <Async query={modes}>
                {(m) => {
                  const bySlug = new Map(m.items.map((x) => [x.slug, x]));
                  return (
                    <div className="space-y-6">
                      <ul className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Interview type">
                        {interviewTypes.map((t) => {
                          const mode = bySlug.get(t.slug);
                          const selected = !!mode && modeId === mode.id;
                          const Icon = t.icon;
                          return (
                            <li key={t.id}>
                              <button type="button" role="radio" aria-checked={selected} disabled={!mode} onClick={() => mode && setModeId(mode.id)}
                                className={cn('group relative h-full w-full rounded-2xl border p-5 text-left transition disabled:cursor-not-allowed disabled:opacity-45',
                                  selected ? 'border-accent bg-accent-soft shadow-[0_0_40px_-12px_var(--glow-a)]' : 'border-border bg-surface-2 enabled:hover:-translate-y-0.5 enabled:hover:border-border-strong')}>
                                {selected && <span className="absolute right-4 top-4 grid size-5 place-items-center rounded-full bg-accent text-accent-fg"><Check size={12} aria-hidden /></span>}
                                <span className="mb-4 grid size-10 place-items-center rounded-xl bg-surface-2 text-accent"><Icon size={19} aria-hidden /></span>
                                <p className="font-medium">{t.label} interview</p>
                                <p className="mt-1 text-xs leading-relaxed text-muted">{mode ? t.blurb : 'Not available for this domain yet.'}</p>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                      {otherModes.length > 0 && (
                        <div>
                          <p className="eyebrow mb-3">More formats</p>
                          <ul className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="More interview formats">
                            {otherModes.map((x) => {
                              const kinds = [...new Set(x.stageKinds)];
                              return (
                                <li key={x.id}>
                                  <button type="button" role="radio" aria-checked={modeId === x.id} onClick={() => setModeId(x.id)}
                                    className={cn('relative h-full w-full rounded-2xl border p-4 text-left transition', modeId === x.id ? 'border-accent bg-accent-soft' : 'border-border bg-surface-2 hover:border-border-strong')}>
                                    {modeId === x.id && <span className="absolute right-3 top-3 grid size-5 place-items-center rounded-full bg-accent text-accent-fg"><Check size={12} aria-hidden /></span>}
                                    <p className="text-sm font-medium">{x.name}</p>
                                    <p className="mt-1 text-xs text-muted">{kinds.map((k) => kindMeta[k].label).join(' · ')}</p>
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                      {m.items.length === 0 && <p className="text-sm text-muted">No formats are published for this domain yet.</p>}
                    </div>
                  );
                }}
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
