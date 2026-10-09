import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite, types, type Transaction } from '@electric-sql/pglite';
import { makeDb, type Db, type Sql } from '../../src/db/db';
import { migrate } from '../../src/db/migrate';

const SHIM = join(dirname(fileURLToPath(import.meta.url)), '../supabase-shim.sql');

/**
 * node-postgres returns int8 and numeric as strings. PGlite parses them as numbers by default, which
 * would hide bugs that only show up against real Postgres, so the test Db mirrors pg's behavior.
 */
const PG_COMPATIBLE_PARSERS = {
  [types.INT8]: (v: string) => v,
  [types.NUMERIC]: (v: string) => v,
};

function sqlOf(conn: PGlite | Transaction): Sql {
  return {
    async query<T>(text: string, params?: unknown[]) {
      // Parameterless text may hold several statements (migrations); only the simple protocol allows that.
      if (!params || params.length === 0) {
        const results = await conn.exec(text);
        return (results.at(-1)?.rows ?? []) as T[];
      }
      return (await conn.query<T>(text, params)).rows;
    },
  };
}

export interface TestDb extends Db {
  pg: PGlite;
  /** Makes the next query whose text matches `pattern` throw, once. For rollback tests. */
  failNext(pattern: RegExp): void;
}

/**
 * A Db backed by in-process Postgres (PGlite), with the Supabase shim and every migration applied.
 * PGlite is one connection, so a query issued on the base handle while a transaction is open waits for
 * it; code that does that would deadlock in tests and exhaust the pool in production.
 */
export async function createTestDb(): Promise<TestDb> {
  const pg = await PGlite.create({ parsers: PG_COMPATIBLE_PARSERS });
  await pg.exec(await readFile(SHIM, 'utf8'));
  let trap: RegExp | null = null;
  const guard = (sql: Sql): Sql => ({
    query(text, params) {
      if (trap && trap.test(text)) {
        trap = null;
        return Promise.reject(new Error(`injected failure: ${text.slice(0, 60)}`));
      }
      return sql.query(text, params);
    },
  });
  const base = guard(sqlOf(pg));
  const db = makeDb(base, (fn) => pg.transaction((tx) => fn(guard(sqlOf(tx)))), () => pg.close());
  await migrate(db);
  return Object.assign(db, { pg, failNext: (p: RegExp) => void (trap = p) });
}
