import type { FastifyInstance, FastifyReply, FastifyRequest, HTTPMethods } from 'fastify';
import type { z } from 'zod';
import type { UserRole } from '@ai-interview/shared';
import { AppError, forbidden, unauthorized, validationError } from './errors';
import type { Config } from '../config';

export type PlatformRole = Extract<UserRole, 'candidate' | 'pack_author' | 'admin'>;
export interface AuthUser {
  id: string;
  email: string | null;
  role: PlatformRole;
}

export type Limit = 'ai' | 'run';

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
  interface FastifyContextConfig {
    public?: boolean;
  }
}

interface RouteDef<P, Q, B> {
  method: HTTPMethods;
  url: string;
  params?: z.ZodType<P>;
  query?: z.ZodType<Q>;
  body?: z.ZodType<B>;
  /** Allowed platform roles. admin always passes. Omit for any signed-in user. */
  roles?: PlatformRole[];
  limit?: Limit;
  public?: boolean;
}

export interface Ctx<P, Q, B> {
  user: AuthUser;
  params: P;
  query: Q;
  body: B;
  req: FastifyRequest;
  reply: FastifyReply;
}

function parse<T>(schema: z.ZodType<T> | undefined, value: unknown, where: string): T {
  if (!schema) return undefined as T;
  const r = schema.safeParse(value ?? {});
  if (!r.success) throw validationError(r.error, where);
  return r.data;
}

/** The one place request input is validated: shared zod schemas at the HTTP boundary. */
export function makeRouter(app: FastifyInstance, config: Config) {
  const perMinute: Record<Limit, number> = { ai: config.RATE_LIMIT_AI_PER_MIN, run: config.RATE_LIMIT_RUN_PER_MIN };
  return function route<P = undefined, Q = undefined, B = undefined>(
    def: RouteDef<P, Q, B>,
    handler: (ctx: Ctx<P, Q, B>) => Promise<unknown>,
  ) {
    app.route({
      method: def.method,
      url: def.url,
      config: {
        public: def.public,
        ...(def.limit ? { rateLimit: { max: perMinute[def.limit], timeWindow: 60_000 } } : {}),
      },
      handler: async (req, reply) => {
        const user = req.user;
        if (!def.public && !user) throw unauthorized();
        if (def.roles && user && user.role !== 'admin' && !def.roles.includes(user.role)) throw forbidden();
        const ctx = {
          user: user as AuthUser,
          params: parse(def.params, req.params, 'params'),
          query: parse(def.query, req.query, 'query'),
          body: parse(def.body, req.body, 'body'),
          req,
          reply,
        };
        const out = await handler(ctx);
        if (reply.sent) return reply;
        if (out === undefined) return reply.status(reply.statusCode === 200 ? 204 : reply.statusCode).send();
        return out;
      },
    });
  };
}

export type Route = ReturnType<typeof makeRouter>;

export const tooLarge = (detail: string) => new AppError(413, 'payload_too_large', 'Payload too large', detail);
