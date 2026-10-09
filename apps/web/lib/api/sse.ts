import { SseEvent } from '@ai-interview/shared';
import { API_URL, authHeaders } from './client';

/** EventSource cannot send an Authorization header, so the stream is read with fetch. */
export async function streamSessionEvents(
  sessionId: string,
  onEvent: (e: SseEvent) => void,
  signal: AbortSignal,
  lastEventId?: number,
): Promise<void> {
  const res = await fetch(`${API_URL}/v1/sessions/${sessionId}/events`, {
    signal,
    headers: { accept: 'text/event-stream', ...(lastEventId ? { 'last-event-id': String(lastEventId) } : {}), ...(await authHeaders()) },
  });
  if (!res.ok || !res.body) throw new Error(`Event stream failed (${res.status})`);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += value.replace(/\r\n?/g, '\n');
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (!data.length) continue;
      try {
        const parsed = SseEvent.safeParse({ event, data: JSON.parse(data.join('\n')) });
        if (parsed.success) onEvent(parsed.data);
      } catch {
        // ignore malformed frame
      }
    }
  }
}
