'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { useTheme } from 'next-themes';
import { CheckCircle2, Clock, Code2, FlaskConical, History, Loader2, MemoryStick, Play, Send, XCircle } from 'lucide-react';
import type { SubmissionResult } from '@ai-interview/shared';
import { loader } from '@monaco-editor/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { runSubmission, useCreateSubmission, useLanguages, useSubmissionResult, useSubmissions } from '@/lib/api/hooks';
import { cn } from '@/lib/cn';
import type { PaneProps } from './types';

loader.config({ paths: { vs: '/monaco/vs' } });

const Editor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => <Skeleton className="h-full min-h-72 w-full" />,
});

const monacoLang: Record<string, string> = { python: 'python', javascript: 'javascript', typescript: 'typescript' };

type Tab = 'problem' | 'code' | 'results';

/**
 * Coding workspace: problem on the left, editor in the middle, results and progress on the right.
 * Below `lg` the three panels become tabs so each one gets the full screen.
 */
export function CodingPane({ stage, question, submitting, onSubmit, rail }: PaneProps) {
  const langs = useLanguages();
  const { resolvedTheme } = useTheme();
  const createSubmission = useCreateSubmission(stage.id);
  const history = useSubmissions(stage.id);
  const [langId, setLangId] = useState<string>();
  const [sources, setSources] = useState<Record<string, string>>({});
  const [explanation, setExplanation] = useState('');
  const [subId, setSubId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState<Tab>('code');

  const lang = useMemo(() => langs.data?.items.find((l) => l.id === (langId ?? langs.data.items[0]?.id)), [langs.data, langId]);
  const source = lang ? (sources[lang.id] ?? question.starterCode?.[lang.slug] ?? '') : '';
  const result = useSubmissionResult(subId, running);

  useEffect(() => {
    if (result.data && (result.data.jobStatus === 'completed' || result.data.jobStatus === 'failed')) setRunning(false);
  }, [result.data]);

  useEffect(() => {
    if (result.isError) {
      setError(result.error);
      setRunning(false);
    }
  }, [result.isError, result.error]);

  async function run() {
    if (!lang) return;
    setError(null);
    setRunning(true);
    setTab((t) => (window.matchMedia('(min-width: 1024px)').matches ? t : 'results'));
    try {
      const sub = await createSubmission.mutateAsync({ languageId: lang.id, source, explanation: explanation.trim() || undefined });
      setSubId(sub.id);
      await runSubmission(sub.id);
    } catch (e) {
      setError(e);
      setRunning(false);
    }
  }

  async function submit() {
    if (!lang) return;
    setError(null);
    try {
      const sub = await createSubmission.mutateAsync({ languageId: lang.id, source, explanation: explanation.trim() || undefined });
      onSubmit({ type: 'code', submissionId: sub.id });
    } catch (e) {
      setError(e);
    }
  }

  if (langs.isPending) return <Skeleton className="h-72 w-full" />;
  if (langs.isError) return <ErrorState error={langs.error} onRetry={() => langs.refetch()} />;
  if (!lang) return <p className="text-sm text-muted">No languages are configured for coding yet.</p>;

  const tabs: { id: Tab; label: string; icon: typeof Code2 }[] = [
    { id: 'problem', label: 'Problem', icon: FlaskConical },
    { id: 'code', label: 'Code', icon: Code2 },
    { id: 'results', label: 'Results', icon: CheckCircle2 },
  ];
  const panel = (id: Tab) => cn('min-h-0 flex-col', tab === id ? 'flex' : 'hidden', 'lg:flex');

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div role="tablist" aria-label="Workspace" className="glass flex rounded-full p-1 lg:hidden">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-sm transition', tab === id ? 'bg-surface-2 font-medium' : 'text-muted')}>
            <Icon size={15} aria-hidden /> {label}
            {id === 'results' && running && <Loader2 size={13} className="animate-spin" aria-hidden />}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.7fr)_minmax(280px,0.9fr)]">
        {/* Problem */}
        <section aria-label="Problem" className={cn(panel('problem'), 'glass gap-4 overflow-y-auto rounded-2xl p-5')}>
          {question.title && <h2 className="text-xl">{question.title}</h2>}
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted">{question.prompt}</p>
          {question.visibleTests && question.visibleTests.length > 0 && (
            <div className="space-y-3">
              <p className="eyebrow">Examples</p>
              {question.visibleTests.map((t) => (
                <div key={t.name} className="rounded-xl border border-border bg-surface-2 p-3 font-mono text-xs">
                  <p className="mb-1 text-muted">Input</p><pre className="whitespace-pre-wrap">{t.input}</pre>
                  <p className="mb-1 mt-3 text-muted">Output</p><pre className="whitespace-pre-wrap">{t.expected}</pre>
                </div>
              ))}
            </div>
          )}
          {question.exhibits?.map((x) => (
            <details key={x.title} open className="rounded-xl border border-border bg-surface-2 p-3 text-sm">
              <summary className="cursor-pointer font-medium">{x.title}</summary>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-muted">{x.body}</pre>
            </details>
          ))}
          <p className="mt-auto rounded-xl border border-dashed border-border-strong p-3 text-xs text-muted">Run checks the examples above. Submit also runs hidden tests. You will see how many passed, never what they contain.</p>
        </section>

        {/* Editor */}
        <section aria-label="Code editor" className={cn(panel('code'), 'gap-3')}>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="lang">Language</label>
            <select id="lang" value={lang.id} onChange={(e) => { setLangId(e.target.value); setSubId(null); setRunning(false); }} className="h-9 rounded-full border border-border bg-surface-2 px-3 text-sm capitalize">
              {langs.data.items.map((l) => <option key={l.id} value={l.id}>{l.slug}</option>)}
            </select>
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" size="sm" onClick={run} disabled={running || submitting || !source.trim()}>
                {running ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Play size={15} aria-hidden />} Run
              </Button>
              <Button size="sm" onClick={submit} disabled={submitting || running || createSubmission.isPending || !source.trim()}>
                <Send size={15} aria-hidden /> Submit
              </Button>
            </div>
          </div>

          <div className="min-h-80 flex-1 overflow-hidden rounded-2xl border border-border">
            <Editor
              height="100%"
              language={monacoLang[lang.slug] ?? lang.slug}
              theme={resolvedTheme === 'light' ? 'light' : 'vs-dark'}
              value={source}
              onChange={(v) => setSources((s) => ({ ...s, [lang.id]: v ?? '' }))}
              options={{ minimap: { enabled: false }, fontSize: 14, scrollBeyondLastLine: false, padding: { top: 14 }, ariaLabel: 'Code editor', fontFamily: 'var(--font-geist-mono), ui-monospace, monospace' }}
            />
          </div>

          <details className="glass rounded-2xl px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium">Explain your approach <span className="font-normal text-muted">(optional, the interviewer reads it)</span></summary>
            <label className="sr-only" htmlFor="explain">Explanation of your approach</label>
            <textarea id="explain" value={explanation} onChange={(e) => setExplanation(e.target.value)} maxLength={5000} rows={3}
              placeholder="Complexity, trade-offs, edge cases you considered…"
              className="mt-3 w-full resize-y rounded-xl border border-border bg-surface-2 p-3 text-sm placeholder:text-muted/70 focus:border-accent" />
          </details>
          {error ? <ErrorState error={error} /> : null}
        </section>

        {/* Results and progress */}
        <section aria-label="Results and progress" className={cn(panel('results'), 'gap-4 overflow-y-auto')}>
          <Results data={result.data} running={running} />
          <Submissions items={history.data?.items ?? []} onLoad={(s) => { setSources((x) => ({ ...x, [s.languageId]: s.source })); setLangId(s.languageId); setExplanation(s.explanation ?? ''); setTab('code'); }} />
          {rail}
        </section>
      </div>
    </div>
  );
}

function Results({ data, running }: { data: SubmissionResult | undefined; running: boolean }) {
  const r = data?.result;
  const time = r ? r.perTest.reduce((n, t) => n + t.timeMs, 0) : 0;
  const mem = r ? Math.max(0, ...r.perTest.map((t) => t.memKb)) : 0;
  return (
    <div className="glass rounded-2xl p-5" aria-live="polite">
      <div className="mb-4 flex items-center justify-between"><p className="eyebrow">Execution</p>
        {running && !r ? <Badge tone="accent"><Loader2 size={12} className="animate-spin" aria-hidden /> Running in sandbox</Badge>
          : r ? <Badge tone={r.status === 'passed' ? 'good' : 'bad'}>{r.status.replace(/_/g, ' ')}</Badge> : <Badge>Idle</Badge>}
      </div>
      {!r ? <p className="text-sm text-muted">{running ? 'Waiting for the sandbox…' : 'Run your code to check it against the examples.'}</p> : (
        <>
          <dl className="mb-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl border border-border bg-surface-2 p-3"><dt className="flex items-center gap-1.5 text-xs text-muted"><Clock size={12} aria-hidden /> Runtime</dt><dd className="mt-1 font-mono">{Math.round(time)} ms</dd></div>
            <div className="rounded-xl border border-border bg-surface-2 p-3"><dt className="flex items-center gap-1.5 text-xs text-muted"><MemoryStick size={12} aria-hidden /> Memory</dt><dd className="mt-1 font-mono">{mem ? `${(mem / 1024).toFixed(1)} MB` : '–'}</dd></div>
          </dl>
          <ul className="space-y-1.5 text-sm">
            {r.perTest.map((t) => (
              <li key={t.name} className="flex items-center gap-2">
                {t.passed ? <CheckCircle2 size={15} className="text-good" aria-label="passed" /> : <XCircle size={15} className="text-bad" aria-label="failed" />}
                {t.name}<span className="ml-auto font-mono text-xs text-muted">{Math.round(t.timeMs)} ms</span>
              </li>
            ))}
          </ul>
          {r.hiddenTotal !== null && (
            <div className="mt-4">
              <p className="mb-1.5 text-xs text-muted">Hidden tests: {r.hiddenPassed ?? 0} of {r.hiddenTotal} passed</p>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2" style={{ width: `${r.hiddenTotal ? ((r.hiddenPassed ?? 0) / r.hiddenTotal) * 100 : 0}%` }} /></div>
            </div>
          )}
          {r.stderr && <pre className="mt-4 max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-bad/10 p-3 font-mono text-xs text-bad">{r.stderr}</pre>}
          {r.stdout && <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-surface-2 p-3 font-mono text-xs text-muted">{r.stdout}</pre>}
        </>
      )}
    </div>
  );
}

function Submissions({ items, onLoad }: { items: { id: string; languageId: string; source: string; explanation: string | null; createdAt: string }[]; onLoad: (s: { languageId: string; source: string; explanation: string | null }) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="glass rounded-2xl p-5">
      <p className="eyebrow mb-3 flex items-center gap-1.5"><History size={12} aria-hidden /> Submission history</p>
      <ul className="space-y-1.5 text-sm">
        {[...items].reverse().slice(0, 6).map((s, i) => (
          <li key={s.id} className="flex items-center justify-between gap-2">
            <span className="text-muted">#{items.length - i} · {new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <button className="rounded-full px-3 py-1 text-xs text-accent-2 hover:bg-surface-2" onClick={() => onLoad(s)}>Load</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
