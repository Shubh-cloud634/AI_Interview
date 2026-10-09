import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import type { InjectOptions } from 'fastify';
import { buildApp, loggerOptions } from '../../src/app';
import { loadConfig, type Config } from '../../src/config';
import { drain } from '../../src/queue/queue';
import type { Extractor } from '../../src/modules/candidate/extractor';
import { TestAi } from './ai';
import { createTestDb, type TestDb } from './db';
import { MemoryStore } from './store';
import { mintToken, TEST_JWT_SECRET, TEST_SUPABASE_URL } from './tokens';

export const TEST_ENV = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://unused-in-tests',
  SUPABASE_URL: TEST_SUPABASE_URL,
  SUPABASE_JWT_SECRET: TEST_JWT_SECRET,
  LOG_LEVEL: 'info',
  // Suites drive many sessions per minute; rate-limit tests override these with small values.
  RATE_LIMIT_GLOBAL_PER_MIN: '100000',
  RATE_LIMIT_AI_PER_MIN: '100000',
  RATE_LIMIT_RUN_PER_MIN: '100000',
} as const;

export function testConfig(env: Record<string, string> = {}): Config {
  return loadConfig({ ...TEST_ENV, ...env });
}

export interface TestUser {
  id: string;
  token: string;
  headers: Record<string, string>;
}

/** Plain-text extractor: no PDF parsing in tests unless a test opts in. */
const textExtractor: Extractor = async (bytes) => new TextDecoder().decode(bytes);

/**
 * Builds the real app with test adapters: PGlite Db, deterministic AI, in-memory store, HS256 tokens.
 * Log lines are captured in `logs` so tests can assert what is (not) logged.
 */
export async function createTestApp(opts: { env?: Record<string, string>; db?: TestDb; extract?: Extractor } = {}) {
  const config = testConfig(opts.env);
  const db = opts.db ?? (await createTestDb());
  const ai = new TestAi();
  const store = new MemoryStore();
  const logs: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      logs.push(String(chunk));
      cb();
    },
  });
  const built = await buildApp({
    config, db, provider: ai, store,
    extract: opts.extract ?? textExtractor,
    logger: { ...(loggerOptions(config) as object), stream },
  });
  await built.app.ready();

  const user = async (id: string = randomUUID()): Promise<TestUser> => {
    const token = await mintToken(id);
    return { id, token, headers: { authorization: `Bearer ${token}` } };
  };

  /** fastify.inject with an optional user; JSON body parsed into `json`. */
  const call = async (u: TestUser | null, o: InjectOptions & { url: string }) => {
    const res = await built.app.inject({ ...o, headers: { ...(u?.headers ?? {}), ...(o.headers ?? {}) } });
    let json: any = undefined;
    try {
      json = res.body ? JSON.parse(res.body) : undefined;
    } catch {
      /* non-JSON body */
    }
    return Object.assign(res, { json });
  };

  return {
    ...built,
    config,
    db,
    ai,
    store,
    logs,
    user,
    call,
    /** Runs every queued job now, retries included. */
    drain: () => drain(db, built.jobs, built.app.log, { ignoreSchedule: true }),
    close: async () => {
      await built.app.close();
      await built.internal.close();
      if (!opts.db) await db.close();
    },
  };
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;

/** Ids of seeded catalog rows, looked up by slug so tests never hardcode uuids. */
export async function seeded(db: TestDb) {
  const modes = await db.query<{ id: string; slug: string; domain: string }>(
    `select m.id, m.slug, d.slug as domain from modes m join packs p on p.id = m.pack_id join domains d on d.id = p.domain_id`,
    [],
  );
  const mode = (slug: string) => {
    const m = modes.find((x) => x.slug === slug);
    if (!m) throw new Error(`no seeded mode ${slug}`);
    return m.id;
  };
  return { modes, mode };
}
