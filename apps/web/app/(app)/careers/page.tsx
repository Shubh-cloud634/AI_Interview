'use client';

import { ExternalLink } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Async } from '@/components/async';
import { Badge } from '@/components/ui/badge';
import { Card, CardTitle } from '@/components/ui/card';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/states';
import { Progress } from '@/components/ui/progress';
import { useRecommendations } from '@/lib/api/hooks';
import { pct } from '@/lib/format';
import { fitBand } from '@/lib/insights';
import { safeHttpUrl } from '@/lib/safe-url';

export default function Careers() {
  const recs = useRecommendations();
  return (
    <>
      <PageHeader eyebrow="Career intelligence" title="Roles that fit what you show." subtitle="Matches combine your resume, interview performance and demonstrated skills. They describe fit, not outcomes. No match guarantees a job." />
      <Async query={recs}>
        {(r) =>
          r.roles.length === 0 ? (
            <EmptyState title="No recommendations yet" body="Upload a resume and complete a session. Matches are based on what you show, not only what you claim." action={<ButtonLink href="/interview/setup">Start an interview</ButtonLink>} />
          ) : (
            <div className="space-y-10">
              <section aria-labelledby="roles">
                <h2 id="roles" className="sr-only">Best-fit roles</h2>
                <ul className="grid gap-5 md:grid-cols-2">
                  {r.roles.map((role, idx) => {
                    const band = fitBand(role.fit);
                    return (
                      <li key={role.roleId}>
                        <Card className="glass-hover h-full">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <Badge tone={band.tone}>{band.label}</Badge>
                              <h3 className="mt-3 text-xl">{role.name}</h3>
                            </div>
                            <p className="text-right"><span className="text-4xl font-semibold tabular-nums tracking-tight">{pct(role.fit)}</span><span className="text-muted">%</span><span className="eyebrow block">match</span></p>
                          </div>
                          <Progress className="mt-5" label={`${role.name} match`} value={role.fit * 100} />
                          {role.explanation && <p className="mt-5 text-sm leading-relaxed text-muted"><span className="font-medium text-fg">Why it fits. </span>{role.explanation}</p>}
                          {role.gaps.length > 0 && (
                            <div className="mt-5">
                              <p className="eyebrow mb-2">Skills to develop</p>
                              <ul className="space-y-2.5 text-sm">
                                {role.gaps.slice(0, 3).map((g) => (
                                  <li key={g.competencyId}>
                                    <div className="mb-1 flex justify-between"><span>{g.name}</span><span className="tabular-nums text-muted">{pct(g.current)} of {pct(g.required)} needed</span></div>
                                    <Progress label={`${g.name} progress to requirement`} value={(g.current / Math.max(g.required, 0.01)) * 100} />
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          <div className="mt-6 flex flex-wrap items-center gap-3">
                            <ButtonLink size="sm" href={r.nextMode ? `/interview/setup?mode=${r.nextMode.modeId}` : '/interview/setup'}>{idx === 0 && r.nextMode ? `Next: ${r.nextMode.name}` : 'Practise for this role'}</ButtonLink>
                          </div>
                        </Card>
                      </li>
                    );
                  })}
                </ul>
              </section>

              {r.gaps.length > 0 && (
                <section aria-labelledby="gaps">
                  <h2 id="gaps" className="mb-4 text-xl">Biggest gaps across roles</h2>
                  <Card>
                    <ul className="grid gap-5 md:grid-cols-2">
                      {r.gaps.slice(0, 6).map((g) => (
                        <li key={g.competencyId}>
                          <div className="mb-1.5 flex justify-between text-sm"><span>{g.name}</span><span className="tabular-nums text-muted">{pct(g.current)} → {pct(g.required)}</span></div>
                          <Progress label={g.name} value={(g.current / Math.max(g.required, 0.01)) * 100} />
                        </li>
                      ))}
                    </ul>
                  </Card>
                </section>
              )}

              {r.learningPath.length > 0 && (
                <section aria-labelledby="path">
                  <h2 id="path" className="mb-4 text-xl">Recommended learning</h2>
                  <Card>
                    <ol className="divide-y divide-border">
                      {r.learningPath.map((l, i) => (
                        <li key={l.id} className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
                          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft font-mono text-sm text-accent">{i + 1}</span>
                          {safeHttpUrl(l.url) ? (
                            <a href={safeHttpUrl(l.url)!} target="_blank" rel="noopener noreferrer" className="flex-1 hover:text-accent-2">{l.title}<span className="block text-xs text-muted">{l.skillName}</span></a>
                          ) : (
                            <span className="flex-1">{l.title}<span className="block text-xs text-muted">{l.skillName}</span></span>
                          )}
                          <ExternalLink size={14} className="text-muted" aria-label="Opens in a new tab" />
                        </li>
                      ))}
                    </ol>
                  </Card>
                </section>
              )}
            </div>
          )
        }
      </Async>
    </>
  );
}
