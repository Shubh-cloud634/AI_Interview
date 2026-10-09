'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useVisualAnalysis, type CameraState } from '@/lib/visual/use-visual-analysis';

const stateText: Record<CameraState, string> = {
  off: 'Camera analysis is off.',
  starting: 'Starting camera…',
  on: 'Camera analysis is on.',
  denied: 'Camera permission was denied. The interview works normally without it.',
  unavailable: 'No camera is available. The interview works normally without it.',
  error: 'Camera analysis could not start. The interview is not affected.',
};

/**
 * Optional and self-contained: it reads nothing from the interview and writes nothing to it.
 * Frames stay in this browser tab and are never recorded, uploaded or saved.
 */
export default function VisualAnalysisPanel() {
  const { state, tip, summary, stream, video, start, stop } = useVisualAnalysis();
  const [open, setOpen] = useState(false);
  const [consenting, setConsenting] = useState(false);
  const preview = useRef<HTMLVideoElement>(null);
  const active = state === 'on' || state === 'starting';

  useEffect(() => {
    if (preview.current) preview.current.srcObject = stream;
  }, [stream, open]);

  return (
    <div className="relative">
      <video ref={video} muted playsInline hidden aria-hidden />
      <Button variant="ghost" size="sm" aria-expanded={open} aria-controls="visual-panel" onClick={() => setOpen((o) => !o)}>
        {active ? <Camera size={15} className="text-good" aria-hidden /> : <CameraOff size={15} aria-hidden />}
        <span className="hidden sm:inline">{state === 'on' ? 'Camera on' : 'Camera'}</span>
      </Button>

      {state === 'on' && (
        <span role="status" className="sr-only">Camera analysis is on. Nothing is recorded or uploaded.</span>
      )}

      {open && (
        <section id="visual-panel" aria-label="Optional camera analysis" className="absolute right-0 top-full z-30 mt-2 w-80 rounded-[var(--radius)] border border-border bg-surface p-4 text-sm shadow-lg">
          <p className="font-medium">Optional camera analysis</p>
          <p className="mt-1 text-muted" aria-live="polite">{stateText[state]}</p>

          {!active && !consenting && (
            <Button className="mt-3 w-full" size="sm" onClick={() => setConsenting(true)}>Turn on…</Button>
          )}

          {!active && consenting && (
            <div className="mt-3 space-y-3">
              <ul className="list-disc space-y-1 pl-4 text-muted">
                <li>Your browser will ask for camera access. You can say no.</li>
                <li>Video is analysed in this tab only. It is never recorded, uploaded or saved.</li>
                <li>It measures only whether a face is in view, how it is framed and lit, and whether your head is turned from the screen.</li>
                <li>It does not judge emotion, personality, honesty or anything about you as a person.</li>
                <li>It never affects your interview score.</li>
              </ul>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => { setConsenting(false); start(); }}>I understand, turn on</Button>
                <Button size="sm" variant="secondary" onClick={() => setConsenting(false)}>Cancel</Button>
              </div>
            </div>
          )}

          {active && (
            <div className="mt-3 space-y-3">
              {stream && <video ref={preview} muted playsInline autoPlay aria-label="Your camera preview, shown only to you" className="aspect-video w-full -scale-x-100 rounded-lg bg-surface-2 object-cover" />}
              {state === 'starting' && <p className="flex items-center gap-2 text-muted"><Loader2 size={14} className="animate-spin" aria-hidden /> Loading on-device model…</p>}
              {tip && <p role="status" className="rounded-lg bg-accent-soft px-3 py-2 text-accent">{tip}</p>}
              {summary && summary.sampledFrames > 0 && (
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                  <dt className="text-muted">Face in view</dt><dd className="text-right">{summary.facePresentPct}%</dd>
                  <dt className="text-muted">Head toward screen</dt><dd className="text-right">{summary.facingScreenPct}%</dd>
                </dl>
              )}
              <p className="flex items-start gap-2 text-xs text-muted"><ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden /> These numbers stay on this device and are discarded when you leave. Head direction depends on where your camera sits and says nothing about attention.</p>
              <Button variant="secondary" size="sm" className="w-full" onClick={stop}>Turn off camera</Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
