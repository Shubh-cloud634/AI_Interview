'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import type { Profile } from '@ai-interview/shared';
import { PageHeader } from '@/components/page-header';
import { Async } from '@/components/async';
import { Card, CardTitle } from '@/components/ui/card';
import { Button, ButtonLink } from '@/components/ui/button';
import { CertaintyBadge, type Certainty } from '@/components/ui/badge';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { Field, Input, inputClass } from '@/components/ui/field';
import { Progress } from '@/components/ui/progress';
import { useProfile, usePatchProfile, useReadiness, useRecommendations } from '@/lib/api/hooks';
import { pct } from '@/lib/format';
import { isProject, profileCompleteness, skillCertainty } from '@/lib/insights';

export default function ProfilePage() {
  const profile = useProfile();
  return (
    <>
      <PageHeader eyebrow="Candidate profile" title="What we know about you." subtitle="Interviews are tailored from this. Every item says whether it is a fact, an inference, or unknown. Fix anything we got wrong." />
      <Async query={profile}>
        {(p) => (p ? <ProfileView p={p} /> : (
          <EmptyState title="No profile yet" body="Upload a resume and we will build one." action={<ButtonLink href="/resume">Upload resume</ButtonLink>} />
        ))}
      </Async>
    </>
  );
}

function Section({ title, kind, children }: { title: string; kind: Certainty; children: ReactNode }) {
  return (
    <Card>
      <div className="mb-5 flex items-center justify-between gap-3"><CardTitle>{title}</CardTitle><CertaintyBadge kind={kind} /></div>
      {children}
    </Card>
  );
}

function ProfileView({ p }: { p: Profile }) {
  const patch = usePatchProfile();
  const readiness = useReadiness();
  const recs = useRecommendations();
  const [saved, setSaved] = useState(false);
  const completeness = profileCompleteness(p);

  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setSaved(false);
    patch.mutate(
      { headline: String(f.get('headline')).trim() || null, summary: String(f.get('summary')).trim() || null },
      { onSuccess: () => setSaved(true) },
    );
  }

  // Details the extraction does not capture yet are shown as unknown, not hidden.
  const notCaptured = ['Projects', 'Internships', 'Certifications', 'Achievements', 'Leadership'];
  const factSkills = p.skills.filter((s) => skillCertainty(s) === 'fact');
  const inferred = p.skills.filter((s) => skillCertainty(s) === 'inference');

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <Section title="Headline and summary" kind="fact">
          <form onSubmit={save} className="space-y-4">
            <Field label="Headline"><Input name="headline" defaultValue={p.headline ?? ''} maxLength={300} /></Field>
            <Field label="Summary"><textarea name="summary" defaultValue={p.summary ?? ''} maxLength={5000} rows={5} className={`${inputClass} h-auto py-3`} /></Field>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={patch.isPending}>{patch.isPending ? 'Saving…' : 'Save changes'}</Button>
              {saved && <span role="status" className="text-sm text-good">Saved</span>}
            </div>
            {patch.isError && <ErrorState error={patch.error} />}
          </form>
        </Section>

        <Section title="Experience" kind={p.experiences.length ? 'fact' : 'unknown'}>
          {p.experiences.length === 0 ? <p className="text-sm text-muted">No work experience found in your resume.</p> : (
            <ol className="relative space-y-6 border-l border-border pl-6">
              {p.experiences.map((x, i) => (
                <li key={i} className="relative">
                  <span aria-hidden className="absolute -left-[29px] top-1.5 size-2.5 rounded-full border-2 border-accent-2 bg-bg" />
                  {isProject(x)
                    ? <p className="font-medium">{x.org} <span className="ml-1 rounded-full border border-border px-2 py-px text-[10px] uppercase tracking-wider text-muted">Project</span></p>
                    : <p className="font-medium">{x.title} <span className="font-normal text-muted">at {x.org}</span></p>}
                  <p className="font-mono text-xs text-muted">{x.start ?? '?'} to {x.end ?? 'present'}</p>
                  {x.description && <p className="mt-2 text-sm leading-relaxed text-muted">{x.description}</p>}
                </li>
              ))}
            </ol>
          )}
        </Section>

        <Section title="Education" kind={p.education.length ? 'fact' : 'unknown'}>
          {p.education.length === 0 ? <p className="text-sm text-muted">No education found in your resume.</p> : (
            <ul className="space-y-4">
              {p.education.map((e, i) => (
                <li key={i}><p className="font-medium">{e.institution}</p><p className="text-sm text-muted">{[e.degree, e.field].filter(Boolean).join(', ')}{e.end ? ` · ${e.end}` : ''}</p></li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Skills stated or evidenced" kind={factSkills.length ? 'fact' : 'unknown'}>
          {factSkills.length === 0 ? <p className="text-sm text-muted">No skills with supporting evidence yet.</p> : <SkillGrid skills={factSkills} />}
        </Section>

        {inferred.length > 0 && (
          <Section title="Skills we inferred" kind="inference">
            <p className="mb-4 text-sm text-muted">Extracted without a supporting quote. Treat as unverified until an interview confirms them.</p>
            <SkillGrid skills={inferred} />
          </Section>
        )}

        <Section title="Not captured yet" kind="unknown">
          <ul className="flex flex-wrap gap-2">
            {notCaptured.map((n) => <li key={n} className="rounded-full border border-dashed border-border-strong px-3 py-1 text-[13px] text-muted">{n}</li>)}
          </ul>
          <p className="mt-4 text-sm text-muted">We do not extract these from resumes yet, so we will not guess. Mention them in an interview and they count.</p>
        </Section>
      </div>

      <aside className="space-y-6 lg:sticky lg:top-8 lg:self-start">
        <Card>
          <CardTitle className="mb-4">Completeness</CardTitle>
          <p className="text-4xl font-semibold tabular-nums">{Math.round(completeness.value)}<span className="text-lg text-muted">%</span></p>
          <Progress className="mt-3" label="Profile completeness" value={completeness.value} />
          {completeness.missing.length > 0 && <p className="mt-3 text-xs text-muted">Missing: {completeness.missing.join(', ')}</p>}
        </Card>
        <Card>
          <div className="mb-4 flex items-center justify-between"><CardTitle>Career intelligence</CardTitle><CertaintyBadge kind="inference" /></div>
          <Async query={recs} skeleton={<p className="text-sm text-muted">Loading…</p>}>
            {(r) => r.domains.length === 0 ? <p className="text-sm text-muted">Complete a session to see which domains fit you.</p> : (
              <ul className="space-y-3">
                {r.domains.slice(0, 3).map((d) => (
                  <li key={d.domainId}><div className="mb-1 flex justify-between text-sm"><span>{d.name}</span><span className="tabular-nums text-muted">{pct(d.strength)}</span></div><Progress label={d.name} value={d.strength * 100} /></li>
                ))}
              </ul>
            )}
          </Async>
          <Async query={readiness} skeleton={null}>
            {(r) => {
              const comm = r.items.find((i) => /communic/i.test(i.competencySlug));
              return comm ? <p className="mt-4 border-t border-border pt-4 text-sm text-muted">Communication indicator: <span className="text-fg">{pct(comm.score)}</span> at {pct(comm.confidence)}% confidence.</p> : null;
            }}
          </Async>
        </Card>
      </aside>
    </div>
  );
}

function SkillGrid({ skills }: { skills: Profile['skills'] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {skills.map((s) => (
        <li key={s.name} className="rounded-2xl border border-border bg-surface-2 p-4">
          <p className="font-medium">{s.name}</p>
          <p className="text-xs text-muted">{s.claimedLevel ? `Claimed level ${s.claimedLevel} of 5` : 'Level not stated'}</p>
          {s.evidence[0] && <p className="mt-2 line-clamp-2 text-xs italic text-muted">“{s.evidence[0]}”</p>}
        </li>
      ))}
    </ul>
  );
}
