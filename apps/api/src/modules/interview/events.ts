import { EventEmitter } from 'node:events';
import type { FastifyReply } from 'fastify';
import { InterviewerContent, type SessionStatus, type SseEvent, type StageKind } from '@ai-interview/shared';
import type { Db } from '../../db/db';
import { iso } from '../../db/db';
import { notFound } from '../../http/errors';

export type BusMessage = { type: 'changed' } | { type: 'token'; seq: number; delta: string };

/**
 * In-process fan-out for low latency. Durable events come from the turns table, so an SSE client
 * on another instance still gets every question (by polling), only without live tokens.
 */
export class SessionBus {
  private readonly em = new EventEmitter().setMaxListeners(0);
  publish(sessionId: string, msg: BusMessage) {
    this.em.emit(sessionId, msg);
  }
  subscribe(sessionId: string, fn: (msg: BusMessage) => void): () => void {
    this.em.on(sessionId, fn);
    return () => this.em.off(sessionId, fn);
  }
}

const POLL_MS = 1500;
const HEARTBEAT_MS = 15_000;

function write(reply: FastifyReply, e: SseEvent, id?: number) {
  reply.raw.write(`${id !== undefined ? `id: ${id}\n` : ''}event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
}

export async function streamSessionEvents(deps: { db: Db; bus: SessionBus }, userId: string, sessionId: string, lastEventId: number, reply: FastifyReply) {
  const { db, bus } = deps;
  const [owned] = await db.asUser(userId, (sql) => sql.query('select 1 from sessions where id = $1', [sessionId]));
  if (!owned) throw notFound('session');

  reply.hijack();
  // A hijacked reply bypasses Fastify's header handling, so carry over what hooks already set
  // (CORS, security headers); otherwise a cross-origin EventSource is blocked by the browser.
  reply.raw.writeHead(200, {
    ...(reply.getHeaders() as Record<string, string>),
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });

  let last = lastEventId;
  let closed = false;
  let chain = Promise.resolve();

  const flush = async () => {
    if (closed) return;
    const { turns, status } = await db.asUser(userId, async (sql) => ({
      turns: await sql.query<{ seq: number; content: unknown; created_at: Date; idx: number; stage_id: string; kind: StageKind }>(
        `select t.seq, t.content, t.created_at, sr.idx, sr.stage_id, sr.kind from turns t join stage_runs sr on sr.id = t.stage_run_id
         where t.session_id = $1 and t.seq > $2 and t.actor = 'interviewer' order by t.seq`,
        [sessionId, last],
      ),
      status: (await sql.query<{ status: SessionStatus }>('select status from sessions where id = $1', [sessionId]))[0]?.status,
    }));
    for (const t of turns) {
      const content = InterviewerContent.parse(t.content);
      // Each stage opens with exactly one question turn, so a question marks a stage change.
      if (content.type === 'question') write(reply, { event: 'stage_change', data: { stageIdx: t.idx, stageId: t.stage_id, kind: t.kind } });
      write(reply, { event: 'question', data: { turn: { seq: t.seq, stageIdx: t.idx, actor: 'interviewer', content, createdAt: iso(t.created_at) } } }, t.seq);
      last = t.seq;
    }
    if (status === 'completed' || status === 'abandoned') {
      write(reply, { event: 'done', data: { status } });
      close();
    }
  };
  const schedule = () => {
    chain = chain.then(flush).catch(() => close());
  };

  const unsubscribe = bus.subscribe(sessionId, (msg) => {
    if (closed) return;
    if (msg.type === 'token') write(reply, { event: 'token', data: { seq: msg.seq, delta: msg.delta } });
    else schedule();
  });
  const poll = setInterval(schedule, POLL_MS);
  const heartbeat = setInterval(() => !closed && reply.raw.write(': ping\n\n'), HEARTBEAT_MS);

  function close() {
    if (closed) return;
    closed = true;
    clearInterval(poll);
    clearInterval(heartbeat);
    unsubscribe();
    reply.raw.end();
  }
  reply.raw.on('close', close);
  schedule();
  await chain;
}
