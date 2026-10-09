import pg from 'pg';

export type Row = Record<string, unknown>;

/** A query handle: the pool, or one transaction. Parameterized SQL only. */
export interface Sql {
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Sql {
  /** Service-level transaction. The connection role owns the tables, so RLS does not apply. */
  tx<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
  /** Transaction as app_user with auth.uid() = userId, so RLS backs up the API's ownership checks. */
  asUser<T>(userId: string, fn: (sql: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

type RawTx = <T>(fn: (sql: Sql) => Promise<T>) => Promise<T>;

export function makeDb(base: Sql, rawTx: RawTx, close: () => Promise<void>): Db {
  return {
    query: (text, params) => base.query(text, params),
    tx: rawTx,
    asUser: (userId, fn) =>
      rawTx(async (sql) => {
        await sql.query(
          `select set_config('request.jwt.claims', $1, true), set_config('role', 'app_user', true)`,
          [JSON.stringify({ sub: userId, role: 'authenticated' })],
        );
        return fn(sql);
      }),
    close,
  };
}

export function createPgDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10 });
  const base: Sql = {
    async query<T>(text: string, params?: unknown[]) {
      return (await pool.query(text, params as unknown[])).rows as T[];
    },
  };
  const rawTx: RawTx = async (fn) => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const sql: Sql = {
        async query<T>(text: string, params?: unknown[]) {
          return (await client.query(text, params as unknown[])).rows as T[];
        },
      };
      const out = await fn(sql);
      await client.query('commit');
      return out;
    } catch (err) {
      await client.query('rollback').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  };
  return makeDb(base, rawTx, () => pool.end());
}

export async function one<T>(rows: Promise<T[]>): Promise<T | undefined> {
  return (await rows)[0];
}

export const iso = (d: unknown): string => (d instanceof Date ? d : new Date(String(d))).toISOString();
export const isoOrNull = (d: unknown): string | null => (d == null ? null : iso(d));
