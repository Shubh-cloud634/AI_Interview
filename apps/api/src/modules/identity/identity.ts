import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { FastifyInstance } from 'fastify';
import type { Me, UserRole } from '@ai-interview/shared';
import type { Config } from '../../config';
import type { Db } from '../../db/db';
import { unauthorized } from '../../http/errors';
import type { AuthUser, PlatformRole, Route } from '../../http/route';
import type { ObjectStore } from '../../storage/object-store';

export type TokenVerifier = (token: string) => Promise<{ sub: string; email: string | null }>;

export function createTokenVerifier(config: Config): TokenVerifier {
  const issuer = `${config.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`;
  const key = config.SUPABASE_JWT_SECRET
    ? new TextEncoder().encode(config.SUPABASE_JWT_SECRET)
    : createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return async (token) => {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, key as Parameters<typeof jwtVerify>[1], { issuer, audience: 'authenticated' }));
    } catch {
      throw unauthorized('invalid or expired token');
    }
    if (!payload.sub || !/^[0-9a-f-]{36}$/i.test(payload.sub)) throw unauthorized('token has no user');
    return { sub: payload.sub, email: typeof payload.email === 'string' ? payload.email : null };
  };
}

/** Verifies the bearer token on every non-public route and upserts the user row. Runs before rate limiting. */
export function registerAuth(app: FastifyInstance, db: Db, verify: TokenVerifier) {
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    if (req.routeOptions.config?.public) return;
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    const claims = await verify(header.slice(7));
    const [row] = await db.query<{ platform_role: PlatformRole }>(
      `insert into users (id, email) values ($1, $2)
       on conflict (id) do update set email = coalesce(excluded.email, users.email)
       returning platform_role`,
      [claims.sub, claims.email],
    );
    req.user = { id: claims.sub, email: claims.email, role: row?.platform_role ?? 'candidate' } satisfies AuthUser;
  });
}

export function identityRoutes(route: Route, deps: { db: Db; store: ObjectStore; config: Config }) {
  const { db, store, config } = deps;

  route({ method: 'GET', url: '/v1/me' }, async ({ user }): Promise<Me> => {
    return db.asUser(user.id, async (sql) => {
      const [u] = await sql.query<{ email: string | null; display_name: string | null; locale: string | null; platform_role: PlatformRole }>(
        'select email, display_name, locale, platform_role from users where id = $1',
        [user.id],
      );
      const [org] = await sql.query('select 1 from org_members where user_id = $1 limit 1', [user.id]);
      const roles: UserRole[] = [u?.platform_role ?? 'candidate'];
      if (org) roles.push('org_member');
      return { id: user.id, email: u?.email ?? null, displayName: u?.display_name ?? null, locale: u?.locale ?? null, roles };
    });
  });

  // Data deletion: stored files, app rows (cascading from users), then the Supabase auth user.
  route({ method: 'DELETE', url: '/v1/me' }, async ({ user, req }) => {
    const keys = await db.asUser(user.id, (sql) =>
      sql.query<{ object_key: string }>('select object_key from resumes where user_id = $1', [user.id]),
    );
    await store.remove(keys.map((k) => k.object_key));
    await db.tx(async (sql) => {
      await sql.query(`insert into audit_log (actor_id, action, target_type, target_id) values ($1, 'user.delete', 'user', $1)`, [user.id]);
      await sql.query('delete from users where id = $1', [user.id]);
    });
    if (config.SUPABASE_SERVICE_ROLE_KEY) {
      const res = await fetch(`${config.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/admin/users/${user.id}`, {
        method: 'DELETE',
        headers: { apikey: config.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}` },
      }).catch(() => null);
      if (!res?.ok) req.log.error({ userId: user.id, status: res?.status }, 'auth user deletion failed; app data already deleted');
    }
    return undefined;
  });
}
