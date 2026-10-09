import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { IDEMPOTENCY_HEADER } from '@ai-interview/shared';
import type { Db } from '../db/db';
import { AppError, conflict } from './errors';

const PENDING = 0;

/**
 * Runs a retryable create at most once per (user, Idempotency-Key). A placeholder row is claimed
 * first so concurrent duplicates cannot both run; on failure it is released so the client can retry.
 */
export async function idempotent<T>(
  db: Db,
  userId: string,
  req: FastifyRequest,
  reply: FastifyReply,
  status: number,
  run: () => Promise<T>,
): Promise<T> {
  const key = req.headers[IDEMPOTENCY_HEADER];
  if (key === undefined) {
    reply.status(status);
    return run();
  }
  if (typeof key !== 'string' || key.length < 1 || key.length > 200) {
    throw new AppError(400, 'validation_failed', 'Validation failed', 'Idempotency-Key must be 1-200 characters');
  }
  const hash = createHash('sha256').update(`${req.method} ${req.url}\n${JSON.stringify(req.body ?? null)}`).digest('hex');
  const claimed = await db.asUser(userId, (sql) =>
    sql.query(
      `insert into idempotency_keys (user_id, key, request_hash, status_code, response)
       values ($1, $2, $3, $4, 'null') on conflict do nothing returning key`,
      [userId, key, hash, PENDING],
    ),
  );
  if (claimed.length === 0) {
    const [prior] = await db.asUser(userId, (sql) =>
      sql.query<{ request_hash: string; status_code: number; response: T }>(
        'select request_hash, status_code, response from idempotency_keys where user_id = $1 and key = $2',
        [userId, key],
      ),
    );
    if (!prior || prior.request_hash !== hash) throw conflict('Idempotency-Key was used with a different request');
    if (prior.status_code === PENDING) throw conflict('a request with this Idempotency-Key is still in progress');
    reply.status(prior.status_code);
    return prior.response;
  }
  try {
    const out = await run();
    await db.asUser(userId, (sql) =>
      sql.query('update idempotency_keys set status_code = $3, response = $4 where user_id = $1 and key = $2', [
        userId,
        key,
        status,
        JSON.stringify(out),
      ]),
    );
    reply.status(status);
    return out;
  } catch (err) {
    await db.asUser(userId, (sql) => sql.query('delete from idempotency_keys where user_id = $1 and key = $2', [userId, key]));
    throw err;
  }
}
