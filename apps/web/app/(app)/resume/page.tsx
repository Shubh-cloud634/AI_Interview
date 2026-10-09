'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { ArrowRight, Check, Loader2, UploadCloud } from 'lucide-react';
import { MAX_RESUME_BYTES, ResumeContentType } from '@ai-interview/shared';
import { PageHeader } from '@/components/page-header';
import { Async } from '@/components/async';
import { Card, CardTitle } from '@/components/ui/card';
import { Button, ButtonLink } from '@/components/ui/button';
import { CertaintyBadge } from '@/components/ui/badge';
import { ErrorState, EmptyState } from '@/components/ui/states';
import { Radar } from '@/components/ui/radar';
import { useQueryClient } from '@tanstack/react-query';
import { useProfile, useReadiness, useResume, useUploadResume } from '@/lib/api/hooks';
import { cn } from '@/lib/cn';
import { skillCertainty } from '@/lib/insights';

const accepted = ResumeContentType.options as readonly string[];

const statusText = {
  awaiting_upload: 'Waiting for the upload to finish',
  uploaded: 'Uploaded, queued for analysis',
  parsing: 'Analysing your resume',
  parsed: 'Analysis complete',
  failed: 'Analysis failed',
} as const;

export default function ResumePage() {
  const profile = useProfile();
  const upload = useUploadResume();
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const resumeId = upload.data?.id ?? profile.data?.sourceResumeId ?? null;
  const resume = useResume(resumeId);
  const readiness = useReadiness();
  const qc = useQueryClient();
  const parsed = resume.data?.status === 'parsed';
  useEffect(() => {
    if (!parsed) return;
    qc.invalidateQueries({ queryKey: ['profile'] });
    qc.invalidateQueries({ queryKey: ['readiness'] });
  }, [parsed, qc]);
  const working = upload.isPending || resume.data?.status === 'uploaded' || resume.data?.status === 'parsing';

  function pick(file: File | undefined) {
    setLocalError(null);
    if (!file) return;
    if (!accepted.includes(file.type)) return setLocalError('Upload a PDF, DOCX or plain text file.');
    if (file.size > MAX_RESUME_BYTES) return setLocalError(`That file is over ${MAX_RESUME_BYTES / 1024 / 1024} MB.`);
    upload.mutate(file);
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files[0]);
  };

  const status = resume.data?.status;
  // Where the candidate is in Resume -> Extracted -> Profile -> Intelligence.
  const reached = status === 'parsed' || (!status && profile.data) ? 4 : status === 'parsing' || status === 'uploaded' ? 2 : resumeId ? 1 : 0;

  return (
    <>
      <PageHeader eyebrow="Resume intelligence" title="Your resume, understood." subtitle="Upload it once. We extract what it states, infer what it implies, and flag what we cannot know. All of it shapes your interviews." />

      <ol className="mb-8 grid grid-cols-2 gap-2 md:grid-cols-4" aria-label="Progress">
        {['Resume', 'Extracted information', 'Candidate profile', 'Career intelligence'].map((s, i) => {
          const done = reached > i;
          return (
            <li key={s} aria-current={reached === i ? 'step' : undefined} className={cn('glass flex items-center gap-3 rounded-2xl px-4 py-3 text-sm', done ? 'text-fg' : 'text-muted')}>
              <span className={cn('grid size-6 shrink-0 place-items-center rounded-full text-xs', done ? 'bg-accent-2/20 text-accent-2' : 'bg-surface-2')}>
                {done ? <Check size={13} aria-hidden /> : i + 1}
              </span>
              {s}
            </li>
          );
        })}
      </ol>

      <Card
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn('border-dashed text-center transition md:py-12', dragging && 'border-accent bg-accent-soft')}
      >
        <span className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-accent-soft"><UploadCloud className="text-accent" size={22} aria-hidden /></span>
        <p className="text-lg font-medium">Drop your resume here</p>
        <p className="mt-1 text-sm text-muted">PDF, DOCX or TXT, up to {MAX_RESUME_BYTES / 1024 / 1024} MB</p>
        <input ref={input} type="file" hidden aria-label="Choose resume file" accept={accepted.join(',')} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        <Button className="mt-5" variant="secondary" disabled={working} onClick={() => input.current?.click()}>
          {working ? <><Loader2 className="animate-spin" size={16} aria-hidden /> Working…</> : 'Choose file'}
        </Button>
        {localError && <p role="alert" className="mt-3 text-sm text-bad">{localError}</p>}
      </Card>

      {upload.isError && <div className="mt-5"><ErrorState error={upload.error} onRetry={() => upload.reset()} /></div>}

      {resume.data && (
        <Card className="mt-5" aria-live="polite">
          <div className="flex items-center gap-3">
            {resume.data.status === 'parsed' ? <span className="grid size-9 place-items-center rounded-full bg-good/15"><Check className="text-good" size={17} aria-hidden /></span> : resume.data.status === 'failed' ? null : <Loader2 className="animate-spin text-accent" aria-hidden />}
            <div>
              <p className="font-medium">{resume.data.fileName}</p>
              <p className="text-sm text-muted">{statusText[resume.data.status]}</p>
            </div>
          </div>
          {resume.data.status === 'failed' && <p role="alert" className="mt-3 text-sm text-bad">{resume.data.error ?? 'We could not read this file. Try another format.'}</p>}
        </Card>
      )}

      {resume.data?.status === 'parsed' && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card>
            <div className="mb-4 flex items-center justify-between"><CardTitle>What we found</CardTitle><CertaintyBadge kind="fact" /></div>
            <Async query={profile}>
              {(p) =>
                !p ? <EmptyState title="Nothing extracted" /> : (
                  <div className="space-y-5 text-sm">
                    {p.headline && <p className="text-lg font-medium leading-snug">{p.headline}</p>}
                    <dl className="grid grid-cols-3 gap-3 text-center">
                      {[['Experience', p.experiences.length], ['Education', p.education.length], ['Skills', p.skills.length]].map(([k, v]) => (
                        <div key={k as string} className="rounded-2xl border border-border bg-surface-2 py-3"><dd className="text-2xl font-semibold tabular-nums">{v}</dd><dt className="text-xs text-muted">{k}</dt></div>
                      ))}
                    </dl>
                    <ul className="flex flex-wrap gap-2">
                      {p.skills.slice(0, 24).map((s) => (
                        <li key={s.name} className="rounded-full border border-border bg-surface-2 px-3 py-1 text-[13px]">
                          {s.name} <span className="sr-only">{skillCertainty(s)}</span>
                        </li>
                      ))}
                    </ul>
                    <ButtonLink href="/profile" variant="secondary" size="sm">Review full profile <ArrowRight size={14} aria-hidden /></ButtonLink>
                  </div>
                )
              }
            </Async>
          </Card>
          <Card>
            <div className="mb-2 flex items-center justify-between"><CardTitle>Starting readiness</CardTitle><CertaintyBadge kind="inference" /></div>
            <Async query={readiness}>
              {(r) => <Radar points={r.items.map((i) => ({ label: i.competencyName, value: i.score * 100 }))} />}
            </Async>
            <p className="mt-3 text-xs text-muted">Based on your resume only. Claims count for less than answers in a session. <Link className="text-accent-2 hover:underline" href="/interview/setup">Take an interview</Link> to verify them.</p>
          </Card>
        </div>
      )}
    </>
  );
}
