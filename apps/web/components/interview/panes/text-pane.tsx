'use client';

import { useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PaneProps } from './types';

const key = (sessionId: string, stageRunId: string) => `draft:${sessionId}:${stageRunId}`;
const read = (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const write = (k: string, v: string) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* storage unavailable */ } };

/** Free-text answer. Serves every kind whose accepted content includes `text`. */
export function TextPane({ sessionId, stage, question, submitting, onSubmit }: PaneProps) {
  const k = key(sessionId, stage.id);
  const [text, setText] = useState('');
  useEffect(() => setText(read(k)), [k]);

  const send = async () => {
    const t = text.trim();
    if (!t || submitting) return;
    if (await onSubmit({ type: 'text', text: t })) {
      write(k, '');
      setText('');
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {question.exhibits?.map((x) => (
        <details key={x.title} open className="glass rounded-2xl p-4 text-sm">
          <summary className="cursor-pointer font-medium">{x.title}</summary>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-muted">{x.body}</pre>
        </details>
      ))}
      <div className="glass rounded-2xl p-3 transition focus-within:border-accent">
        <label className="sr-only" htmlFor="answer">Your answer</label>
        <textarea
          id="answer"
          value={text}
          disabled={submitting}
          onChange={(e) => { setText(e.target.value); write(k, e.target.value); }}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') send(); }}
          maxLength={20000}
          rows={5}
          placeholder="Answer as you would out loud. Structure first, detail second."
          className="max-h-[40dvh] min-h-28 w-full resize-y border-0 bg-transparent px-2 py-1 text-base leading-relaxed placeholder:text-muted/70 focus:outline-none"
        />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-1 pt-3">
          <span className="text-xs text-muted">{text.length ? `${text.trim().split(/\s+/).filter(Boolean).length} words · ` : ''}Ctrl + Enter to send · drafts save on this device</span>
          <Button onClick={send} disabled={submitting || !text.trim()}><Send size={15} aria-hidden /> {submitting ? 'Sending…' : 'Send answer'}</Button>
        </div>
      </div>
    </div>
  );
}
