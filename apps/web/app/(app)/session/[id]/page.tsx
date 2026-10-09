'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, DoorOpen } from 'lucide-react';
import type { SessionState, Turn } from '@ai-interview/shared';
import { Avatar, type AvatarState } from '@/components/interview/avatar';
import { EndDialog } from '@/components/interview/end-dialog';
import { ClockReadout, RoomRail, useClocks } from '@/components/interview/room-rail';
import { panes } from '@/components/interview/panes/registry';
import type { PaneProps } from '@/components/interview/panes/types';
import { Logo } from '@/components/layout/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { OptionalVisualAnalysis } from '@/components/visual/optional-visual-analysis';
import { Button } from '@/components/ui/button';
import { CardSkeleton, ErrorState } from '@/components/ui/states';
import { Progress } from '@/components/ui/progress';
import { ApiError } from '@/lib/api/client';
import { useEndSession, useSession, useSessionState, useSubmitTurn } from '@/lib/api/hooks';
import { streamSessionEvents } from '@/lib/api/sse';
import { label } from '@/lib/insights';

export default function Room() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const session = useSession(id);
  const state = useSessionState(id);
  const submit = useSubmitTurn(id);
  const end = useEndSession(id);
  const [live, setLive] = useState('');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const finished = state.data?.status === 'completed' || state.data?.status === 'abandoned';

  useEffect(() => {
    if (finished) router.replace(`/session/${id}/results`);
  }, [finished, id, router]);

  useEffect(() => {
    if (!state.data || finished) return;
    const ctl = new AbortController();
    let lastId: number | undefined;
    (async () => {
      for (let attempt = 0; !ctl.signal.aborted; attempt++) {
        const began = Date.now();
        setLive('');
        try {
          await streamSessionEvents(id, (e) => {
            if (e.event === 'token') setLive((s) => s + e.data.delta);
            else if (e.event === 'question') { lastId = e.data.turn.seq; setLive(''); qc.invalidateQueries({ queryKey: ['session-state', id] }); }
            else if (e.event === 'stage_change') qc.invalidateQueries({ queryKey: ['session-state', id] });
            else if (e.event === 'done') { ctl.abort(); qc.invalidateQueries({ queryKey: ['session-state', id] }); }
          }, ctl.signal, lastId);
        } catch {
          if (ctl.signal.aborted) return;
        }
        if (Date.now() - began > 10_000) attempt = 0;
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 15000)));
      }
    })();
    return () => ctl.abort();
  }, [id, finished, !!state.data, qc]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.isPending || session.isPending) return <div className="mx-auto max-w-3xl p-8"><CardSkeleton lines={5} /></div>;
  if (state.isError || session.isError) return <div className="mx-auto max-w-3xl p-8"><ErrorState error={state.error ?? session.error} onRetry={() => { state.refetch(); session.refetch(); }} /></div>;

  return <RoomView id={id} session={session.data} s={state.data} live={live} submit={submit} onEnd={() => setConfirmEnd(true)}
    dialog={<EndDialog open={confirmEnd} busy={end.isPending} onCancel={() => setConfirmEnd(false)} onConfirm={() => end.mutate(undefined, { onSettled: () => setConfirmEnd(false) })} />} />;
}

type ViewProps = {
  id: string;
  session: NonNullable<ReturnType<typeof useSession>['data']>;
  s: SessionState;
  live: string;
  submit: ReturnType<typeof useSubmitTurn>;
  onEnd: () => void;
  dialog: React.ReactNode;
};

function RoomView({ id, session, s, live, submit, onEnd, dialog }: ViewProps) {
  const clocks = useClocks(session, s);
  const stage = s.currentStage;
  const Pane = stage ? panes[stage.kind] : null;
  const coding = stage?.kind === 'coding';
  const avatar: AvatarState = submit.isPending ? 'thinking' : live ? 'speaking' : 'listening';
  const stagesDone = session.stages.filter((x) => x.status === 'completed').length;
  const rail = <RoomRail session={session} state={s} clocks={clocks} />;

  const onSubmit: PaneProps['onSubmit'] = (content) => submit.mutateAsync({ seq: s.nextSeq, content }).then(() => true, () => false);

  return (
    <div className="flex h-dvh flex-col">
      <header className="glass z-10 flex items-center gap-3 rounded-none border-x-0 border-t-0 px-4 py-3">
        <Link href="/dashboard" aria-label="Rehearse dashboard" className="hidden sm:block"><Logo className="[&>svg]:size-6 [&>span]:hidden" /></Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{session.modeName}</p>
          <p className="truncate text-xs text-muted">Stage {Math.min(stagesDone + 1, session.stages.length)} of {session.stages.length}{stage ? <span className="capitalize"> · {label(stage.stageId)}</span> : null}</p>
        </div>
        <div className="flex items-center gap-4"><ClockReadout seconds={clocks.stageLeft} label="Stage" strong /><span className="hidden sm:inline"><ClockReadout seconds={clocks.sessionLeft} label="Session" /></span></div>
        <OptionalVisualAnalysis />
        <ThemeToggle />
        <Button variant="secondary" size="sm" onClick={onEnd}><DoorOpen size={15} aria-hidden /> <span className="hidden sm:inline">End interview</span><span className="sm:hidden">End</span></Button>
      </header>
      <Progress className="rounded-none" label="Session progress" value={(stagesDone / Math.max(1, session.stages.length)) * 100} />

      {coding && Pane && s.question && stage ? (
        <main id="main" className="min-h-0 flex-1 p-3 md:p-4">
          <Pane key={stage.id} sessionId={id} stage={stage} question={s.question} nextSeq={s.nextSeq} submitting={submit.isPending} onSubmit={onSubmit} rail={rail} />
          {submit.isError && <SubmitError error={submit.error} />}
        </main>
      ) : (
        <div id="main" className="grid min-h-0 flex-1 lg:grid-cols-[320px_minmax(0,1fr)_300px]">
          <section aria-label="Interviewer" className="flex flex-col gap-3 overflow-y-auto border-b border-border p-3 lg:gap-4 lg:border-b-0 lg:border-r lg:p-6">
            <div className="hidden lg:block"><Avatar state={avatar} /></div>
            <div className="lg:hidden"><Avatar state={avatar} compact /></div>
            {s.question && (
              <>
                <div className="glass hidden rounded-2xl p-5 lg:block">
                  <p className="eyebrow mb-2">Current question</p>
                  {s.question.title && <h2 className="mb-2 text-lg leading-snug">{s.question.title}</h2>}
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted">{s.question.prompt}</p>
                </div>
                <details className="group lg:hidden">
                  <summary className="glass flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0 truncate"><span className="text-muted">Question · </span>{s.question.title ?? s.question.prompt}</span>
                    <ChevronDown size={16} className="shrink-0 transition group-open:rotate-180" aria-hidden />
                  </summary>
                  <p className="glass mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-2xl p-4 text-sm leading-relaxed text-muted">{s.question.prompt}</p>
                </details>
              </>
            )}
            <details className="group lg:hidden">
              <summary className="glass flex cursor-pointer list-none items-center justify-between rounded-2xl px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">Interview progress <ChevronDown size={16} className="transition group-open:rotate-180" aria-hidden /></summary>
              <div className="mt-3">{rail}</div>
            </details>
          </section>

          <section aria-label="Interview" className="flex min-h-0 flex-col">
            <Transcript state={s} live={live} />
            <div className="border-t border-border bg-bg/60 p-3 backdrop-blur md:p-5">
              {s.question && stage && Pane ? (
                <>
                  <Pane key={stage.id} sessionId={id} stage={stage} question={s.question} nextSeq={s.nextSeq} submitting={submit.isPending} onSubmit={onSubmit} />
                  {submit.isError && <SubmitError error={submit.error} />}
                </>
              ) : (
                <p className="py-6 text-center text-muted" role="status">Wrapping up…</p>
              )}
            </div>
          </section>

          <aside aria-label="Session details" className="hidden overflow-y-auto border-l border-border p-6 lg:block">{rail}</aside>
        </div>
      )}
      {dialog}
    </div>
  );
}

function SubmitError({ error }: { error: unknown }) {
  const seq = error instanceof ApiError && error.code === 'seq_conflict';
  return seq
    ? <p role="alert" className="mt-3 text-sm text-warn">The session moved on in another tab. Your view has been refreshed, please resend your answer.</p>
    : <div className="mt-3"><ErrorState error={error} /></div>;
}

function Transcript({ state, live }: { state: SessionState; live: string }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [state.turns.length, live]);
  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-6 md:px-8" role="log" aria-live="polite" aria-label="Interview transcript">
      {state.turns.length === 0 && !live && <p className="text-center text-sm text-muted">Aria is preparing your first question…</p>}
      {state.turns.map((t) => <Entry key={t.seq} turn={t} />)}
      {live && <Line who="Aria" mine={false}>{live}<span className="ml-0.5 inline-block h-4 w-px animate-pulse bg-accent-2 align-middle" /></Line>}
      <div ref={end} />
    </div>
  );
}

function Entry({ turn }: { turn: Turn }) {
  const c = turn.content;
  const text =
    c.type === 'text' ? c.text :
    c.type === 'follow_up' ? c.text :
    c.type === 'question' ? (c.question.title ?? c.question.prompt) :
    c.type === 'code' ? 'Submitted a code solution' : 'Submitted a structured answer';
  const mine = turn.actor === 'candidate';
  const tag = c.type === 'follow_up' ? 'Follow-up' : c.type === 'question' ? 'Question' : null;
  return <Line who={mine ? 'You' : 'Aria'} mine={mine} tag={tag}>{text}</Line>;
}

function Line({ who, mine, tag, children }: { who: string; mine: boolean; tag?: string | null; children: React.ReactNode }) {
  return (
    <div className={`max-w-2xl ${mine ? 'ml-auto' : ''}`}>
      <p className={`mb-1.5 flex items-center gap-2 text-xs ${mine ? 'justify-end' : ''}`}>
        <span className={mine ? 'text-muted' : 'font-medium text-accent-2'}>{who}</span>
        {tag && <span className="rounded-full border border-border px-2 py-px text-[10px] uppercase tracking-wider text-muted">{tag}</span>}
      </p>
      <div className={`whitespace-pre-wrap text-[15px] leading-relaxed ${mine ? 'rounded-2xl border border-border bg-surface-2 px-4 py-3 text-fg' : 'border-l-2 border-accent-2/50 pl-4'}`}>{children}</div>
    </div>
  );
}
