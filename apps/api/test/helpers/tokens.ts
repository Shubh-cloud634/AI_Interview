import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';

export const TEST_SUPABASE_URL = 'https://project.supabase.test';
export const TEST_JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-characters-long';

/**
 * Mints an HS256 access token shaped like Supabase's, which identity.createTokenVerifier checks:
 * issuer `${SUPABASE_URL}/auth/v1`, audience `authenticated`, uuid `sub`.
 */
export async function mintToken(
  sub: string = randomUUID(),
  opts: { email?: string; secret?: string; issuer?: string; audience?: string; expiresIn?: string } = {},
): Promise<string> {
  return new SignJWT({ email: opts.email ?? `${sub.slice(0, 8)}@example.test`, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuer(opts.issuer ?? `${TEST_SUPABASE_URL}/auth/v1`)
    .setAudience(opts.audience ?? 'authenticated')
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '1h')
    .sign(new TextEncoder().encode(opts.secret ?? TEST_JWT_SECRET));
}
