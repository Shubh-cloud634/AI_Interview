import type { FastifyInstance, FastifyReply } from 'fastify';

/**
 * Response headers for a JSON-only API. Nothing it serves is meant to render or be framed, and
 * responses carry personal data, so nothing may be cached by shared caches.
 */
export function securityHeaders(production: boolean): Record<string, string> {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer',
    'cross-origin-resource-policy': 'same-site',
    'cache-control': 'no-store',
    ...(production ? { 'strict-transport-security': 'max-age=63072000; includeSubDomains' } : {}),
  };
}

export function registerSecurityHeaders(app: FastifyInstance, production: boolean) {
  const headers = securityHeaders(production);
  // onRequest, so error replies, 404s, 429s and hijacked (SSE) replies, which skip onSend, still get them.
  app.addHook('onRequest', async (_req, reply: FastifyReply) => {
    reply.headers(headers);
  });
}
