'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyCounters, liveTip, observe, summarize, type Counters, type FrameObservation, type VisualSummary } from './aggregator';

export type CameraState = 'off' | 'starting' | 'on' | 'denied' | 'unavailable' | 'error';

const SAMPLE_MS = 500;

/**
 * Local-only camera analysis. Frames are read from a hidden video element, reduced to a few numbers,
 * and dropped. Nothing is recorded, uploaded or persisted, including the on/off choice.
 */
export function useVisualAnalysis() {
  const [state, setState] = useState<CameraState>('off');
  const [tip, setTip] = useState<string | null>(null);
  const [summary, setSummary] = useState<VisualSummary | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const counters = useRef<Counters>(emptyCounters());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const run = useRef(0);
  const detectorRef = useRef<{ close: () => void } | null>(null);

  const stop = useCallback(() => {
    run.current++;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    detectorRef.current?.close();
    detectorRef.current = null;
    setStream((s) => {
      s?.getTracks().forEach((t) => t.stop());
      return null;
    });
    setTip(null);
    setState('off');
  }, []);

  const start = useCallback(async () => {
    stop();
    const token = ++run.current;
    counters.current = emptyCounters();
    setSummary(null);
    setState('starting');
    try {
      if (!navigator.mediaDevices?.getUserMedia) return setState('unavailable');
      const media = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
      if (token !== run.current) return media.getTracks().forEach((t) => t.stop());
      media.getVideoTracks()[0]?.addEventListener('ended', () => token === run.current && stop());
      setStream(media);

      const { createDetector } = await import('./detector');
      const detector = await createDetector();
      if (token !== run.current) return detector.close();
      detectorRef.current = detector;

      const v = video.current;
      if (!v) {
        stop();
        return setState('error');
      }
      v.srcObject = media;
      await v.play();
      setState('on');

      const sample = () => {
        if (token !== run.current || v.readyState < 2) return;
        let o: FrameObservation | null = null;
        try {
          o = detector.observe(v);
        } catch {
          return;
        }
        counters.current = observe(counters.current, o);
        setTip(liveTip(o));
        setSummary(summarize(counters.current));
      };
      timer.current = setInterval(sample, SAMPLE_MS);
    } catch (e) {
      if (token !== run.current) return;
      const name = e instanceof DOMException ? e.name : '';
      setState(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' || name === 'NotReadableError' ? 'unavailable' : 'error');
    }
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { state, tip, summary, stream, video, start, stop };
}
