import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import type { ErrorCode, Problem } from '@ai-interview/shared';
import type { z } from 'zod';

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly title: string,
    readonly detail?: string,
    readonly extra: Partial<Problem> = {},
  ) {
    super(detail ?? title);
  }
}

export const notFound = (what: string) => new AppError(404, 'not_found', 'Not found', `${what} not found`);
export const forbidden = () => new AppError(403, 'forbidden', 'Forbidden');
export const unauthorized = (detail = 'missing or invalid token') => new AppError(401, 'unauthorized', 'Unauthorized', detail);
export const conflict = (detail: string, extra: Partial<Problem> = {}) => new AppError(409, 'conflict', 'Conflict', detail, extra);
export const invalidState = (detail: string) => new AppError(409, 'invalid_state', 'Invalid state', detail);

export function validationError(error: z.ZodError, where: string): AppError {
  return new AppError(400, 'validation_failed', 'Validation failed', `invalid ${where}`, {
    errors: error.issues.map((i) => ({ path: [where, ...i.path].join('.'), message: i.message })),
  });
}

const STATUS_CODES: Record<number, ErrorCode> = {
  400: 'validation_failed',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'validation_failed',
  429: 'rate_limited',
};

export function toProblem(err: unknown, instance: string): Problem {
  if (err instanceof AppError) {
    return { type: `https://errors.ai-interview.dev/${err.code}`, title: err.title, status: err.status, code: err.code, detail: err.detail, instance, ...err.extra };
  }
  const fe = err as Partial<FastifyError>;
  const status = typeof fe.statusCode === 'number' && fe.statusCode >= 400 && fe.statusCode < 500 ? fe.statusCode : 500;
  const code = STATUS_CODES[status] ?? 'internal';
  return {
    type: `https://errors.ai-interview.dev/${code}`,
    title: status === 500 ? 'Internal error' : (fe.message ?? 'Request error'),
    status,
    code,
    instance,
  };
}

export function problemHandler(err: unknown, req: FastifyRequest, reply: FastifyReply) {
  const problem = toProblem(err, req.url.split('?')[0] ?? req.url);
  if (problem.status >= 500) req.log.error({ err }, 'request failed');
  const headers = (err as { headers?: Record<string, string> }).headers;
  if (headers) reply.headers(headers);
  return reply.status(problem.status).type('application/problem+json').send(problem);
}
