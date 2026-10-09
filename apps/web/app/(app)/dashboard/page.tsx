'use client';

import Link from 'next/link';
import { ArrowRight, ArrowUpRight, Play, TrendingDown, TrendingUp } from 'lucide-react';
import { Async } from '@/components/async';
import { Badge } from '@/components/ui/badge';
import { Card, CardTitle, Eyebrow } from '@/components/ui/card';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, Skeleton } from '@/components/ui/states';
import { Progress } from '@/components/ui/progress';
import { Radar } from '@/components/ui/radar';
import { ScoreRing } from '@/components/ui/score-ring';
import { TrendLine } from '@/components/ui/trend-line';
import { useHistory, useMe, useMyAnalytics, useProfile, useReadiness, useRecommendations, useTrends } from '@/lib/api/hooks';
import { pct, shortDate } from '@/lib/format';
import { fitBand, greeting, label, profileCompleteness, readinessLevel, readinessScore } from '@/lib/insights';

export default function Dashboard() {
  const me = useMe();
  const profile = useProfile();
  const readiness = useReadiness();
  const history = useHistory({});
  const stats = useMyAnalytics();
  const recs = useRecommendations();
  const trends = useTrends();

  const first = me.data?.displayName?.split(' ')[0];
  const score = readiness.data ? readinessScore(readiness.data.items) : null;
  const level = readinessLevel(score);
  const completeness = profileCompleteness(profile.data);
  const items = readiness.data?.items ?? [];
  const strongest = [...items].sort((a, b) => b.score - a.score).slice(0, 3);
  const weakest = [...items].sort((a, b) => a.score - b.score).slice(0, 3);

  return (
    <div className="space-y-6">
      {/* Cockpit header: greeting, readiness, and the one thing to do next. */}
      <section className="glass noise rise relative overflow-hidden rounded-[22px] p-6 md:p-10" aria-labelledby="hello">
        <div aria-hidden className="grid-lines absolute inset-0 opacity-60" />
        <div className="relative grid items-center gap-8 md:grid-cols-[1fr_auto]">
          <div>
            <Eyebrow>{greeting()}</Eyebrow>
            <h1 id="hello" className="display mt-3 text-4xl md:text-6xl">{first ? first : 'Welcome'}, <span className="text-gradient">ready to practise?</span></h1>
            <Async query={recs} skeleton={<Skeleton className="mt-5 h-10 w-80" />}>
              {(r) => (
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <ButtonLink href={r.nextMode ? `/interview/setup?mode=${r.nextMode.modeId}` : '/interview/setup'} size="lg">
                    <Play size={16} aria-hidden /> {r.nextMode ? `Start ${r.nextMode.name}` : 'Start interview'}
                  </ButtonLink>
                  <p className="text-sm text-muted">
                    {r.nextMode ? (r.gaps[0] ? `Recommended to work on ${r.gaps[0].name}.` : 'Recommended from your recent sessions.') : '30 to 40 minutes. Leave any time.'}
                  </p>
                </div>
              )}
            </Async>
          </div>
          <div className="flex items-center gap-6 md:flex-col md:items-end md:gap-4">
            {readiness.isPending ? <Skeleton className="size-36 rounded-full" /> : score === null
              ? <div className="grid size-36 place-items-center rounded-full border border-dashed border-border-strong text-center text-xs text-muted">No score<br />yet</div>
              : <ScoreRing value={score} label="Readiness score" caption="Readiness" />}
            <Badge tone={level.tone}>{level.label}</Badge>
          </div>
        </div>
      </section>

      {/* Key numbers, kept small so the chart area carries the page. */}
      <Async query={stats} skeleton={<div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>}>
        {(s) => (
          <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
            <Stat label="Sessions completed" value={String(s.sessionsCompleted)} note={`of ${s.sessionsStarted} started`} />
            <Stat label="Average score" value={s.averageOverall === null ? '–' : pct(s.averageOverall)} note="across scored sessions" />
            <Stat label="Last active" value={s.lastActiveAt ? shortDate(s.lastActiveAt) : '–'} note="keep a steady rhythm" />
            <Card className="p-5 md:p-5">
              <div className="flex items-center justify-between"><Eyebrow>Profile</Eyebrow><span className="text-sm font-medium">{Math.round(completeness.value)}%</span></div>
              <Progress className="mt-4" label="Profile completeness" value={completeness.value} />
              <p className="mt-3 text-xs text-muted">{completeness.missing.length ? `Add: ${completeness.missing.slice(0, 2).join(', ')}` : 'Complete'} · <Link className="text-accent-2 hover:underline" href={profile.data ? '/profile' : '/resume'}>{profile.data ? 'Review' : 'Upload resume'}</Link></p>
            </Card>
          </div>
        )}
      </Async>

      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <div className="mb-2 flex items-center justify-between"><CardTitle>Skill readiness</CardTitle><Eyebrow>By competency</Eyebrow></div>
          <Async query={readiness}>
            {(r) =>
              r.items.length === 0 ? (
                <EmptyState title="No readiness data yet" body="Upload a resume or finish a session to see where you stand." action={<ButtonLink href="/resume" variant="secondary">Upload resume</ButtonLink>} />
              ) : (
                <div className="grid items-center gap-6 sm:grid-cols-[1fr_11rem]">
                  <Radar points={r.items.map((i) => ({ label: i.competencyName, value: i.score * 100 }))} />
                  <div className="space-y-5 text-sm sm:w-44">
                    <Group title="Strongest" tone="text-good" rows={strongest.map((i) => [i.competencyName, i.score])} />
                    <Group title="Focus areas" tone="text-warn" rows={weakest.map((i) => [i.competencyName, i.score])} />
                  </div>
                </div>
              )
            }
          </Async>
        </Card>

        <Card>
          <div className="mb-4 flex items-center justify-between"><CardTitle>Best-fit roles</CardTitle><Link href="/careers" className="flex items-center gap-1 text-sm text-accent-2 hover:underline">All <ArrowRight size={14} aria-hidden /></Link></div>
          <Async query={recs}>
            {(r) =>
              r.roles.length === 0 ? (
                <p className="text-sm text-muted">Complete a session to unlock role matches based on what you demonstrate.</p>
              ) : (
                <ul className="space-y-4">
                  {r.roles.slice(0, 3).map((role) => {
                    const band = fitBand(role.fit);
                    return (
                      <li key={role.roleId}>
                        <div className="mb-1.5 flex items-baseline justify-between gap-3"><span className="font-medium">{role.name}</span><span className="text-sm tabular-nums">{pct(role.fit)}%</span></div>
                        <Progress label={`${role.name} match`} value={role.fit * 100} />
                        <p className="mt-1.5 text-xs text-muted">{band.label}</p>
                      </li>
                    );
                  })}
                </ul>
              )
            }
          </Async>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <CardTitle>Performance trend</CardTitle>
            <Async query={trends} skeleton={null}>
              {(t) => <Delta points={t.points.map((p) => p.score)} />}
            </Async>
          </div>
          <Async query={trends}>
            {(t) => (t.points.length > 1 ? <TrendLine points={t.points.map((p) => ({ x: p.finishedAt, y: p.score }))} /> : <p className="py-8 text-center text-sm text-muted">Finish two sessions to see your trend.</p>)}
          </Async>
        </Card>

        <Card>
          <div className="mb-4 flex items-center justify-between"><CardTitle>Recent sessions</CardTitle><Link href="/history" className="flex items-center gap-1 text-sm text-accent-2 hover:underline">Progress <ArrowRight size={14} aria-hidden /></Link></div>
          <Async query={history}>
            {(h) =>
              h.items.length === 0 ? (
                <EmptyState title="No sessions yet" action={<ButtonLink href="/interview/setup">Start your first</ButtonLink>} />
              ) : (
                <ul className="divide-y divide-border">
                  {h.items.slice(0, 5).map((s) => (
                    <li key={s.sessionId}>
                      <Link href={`/report/${s.sessionId}`} className="group flex items-center justify-between gap-3 py-3">
                        <span className="min-w-0"><span className="block truncate capitalize group-hover:text-accent-2">{label(s.modeSlug)}</span><span className="text-xs text-muted">{shortDate(s.finishedAt)}</span></span>
                        <span className="flex items-center gap-1 font-medium tabular-nums">{s.overall === null ? 'Unscored' : pct(s.overall)}<ArrowUpRight size={14} className="text-muted" aria-hidden /></span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )
            }
          </Async>
        </Card>
      </div>

      <Async query={recs} skeleton={null}>
        {(r) =>
          r.learningPath.length > 0 ? (
            <Card>
              <CardTitle className="mb-4">Your next goals</CardTitle>
              <ul className="grid gap-3 md:grid-cols-3">
                {r.learningPath.slice(0, 3).map((l, i) => (
                  <li key={l.id} className="rounded-2xl border border-border bg-surface-2 p-4">
                    <p className="font-mono text-xs text-accent-2">0{i + 1}</p>
                    <p className="mt-2 text-sm font-medium">{l.title}</p>
                    <p className="mt-1 text-xs text-muted">{l.skillName}</p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null
        }
      </Async>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <Card className="p-4 md:p-5">
      <Eyebrow>{label}</Eyebrow>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums md:mt-3 md:text-3xl">{value}</p>
      <p className="mt-1 text-xs text-muted">{note}</p>
    </Card>
  );
}

function Group({ title, tone, rows }: { title: string; tone: string; rows: [string, number][] }) {
  return (
    <div>
      <p className={`mb-2 text-xs font-medium uppercase tracking-wider ${tone}`}>{title}</p>
      <ul className="space-y-1.5">
        {rows.map(([n, v]) => <li key={n} className="flex justify-between gap-2"><span className="truncate">{n}</span><span className="tabular-nums text-muted">{pct(v)}</span></li>)}
      </ul>
    </div>
  );
}

function Delta({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const d = Math.round((points[points.length - 1]! - points[0]!) * 100);
  const up = d >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return <Badge tone={up ? 'good' : 'warn'}><Icon size={12} aria-hidden /> {up ? '+' : ''}{d} since first session</Badge>;
}
