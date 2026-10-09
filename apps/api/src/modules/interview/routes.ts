import { z } from 'zod';
import { CreateSessionRequest, IdParams, SubmitTurnRequest, type Session, type SessionState, type SubmitTurnResponse } from '@ai-interview/shared';
import type { Db } from '../../db/db';
import { idempotent } from '../../http/idempotency';
import type { Route } from '../../http/route';
import type { Engine } from './engine';
import { streamSessionEvents, type SessionBus } from './events';

const EventsQuery = z.object({ lastEventId: z.coerce.number().int().min(0).optional() });

export function interviewRoutes(route: Route, deps: { db: Db; engine: Engine; bus: SessionBus }) {
  const { db, engine, bus } = deps;

  route({ method: 'POST', url: '/v1/sessions', body: CreateSessionRequest, limit: 'ai' }, async ({ user, body, req, reply }): Promise<Session> =>
    idempotent(db, user.id, req, reply, 201, () => engine.createSession(user.id, body)),
  );

  route({ method: 'GET', url: '/v1/sessions/:id', params: IdParams }, async ({ user, params }): Promise<Session> => engine.getSession(user.id, params.id));

  route({ method: 'GET', url: '/v1/sessions/:id/state', params: IdParams }, async ({ user, params }): Promise<SessionState> => engine.getState(user.id, params.id));

  route({ method: 'POST', url: '/v1/sessions/:id/turns', params: IdParams, body: SubmitTurnRequest, limit: 'ai' }, async ({ user, params, body }): Promise<SubmitTurnResponse> =>
    engine.submitTurn(user.id, params.id, body),
  );

  route({ method: 'GET', url: '/v1/sessions/:id/events', params: IdParams, query: EventsQuery }, async ({ user, params, query, req, reply }) => {
    const header = Number(req.headers['last-event-id']);
    const last = Number.isInteger(header) && header >= 0 ? header : (query.lastEventId ?? 0);
    await streamSessionEvents({ db, bus }, user.id, params.id, last, reply);
    return reply;
  });

  route({ method: 'POST', url: '/v1/sessions/:id/end', params: IdParams }, async ({ user, params }): Promise<Session> => engine.end(user.id, params.id));
}
