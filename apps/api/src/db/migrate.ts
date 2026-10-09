import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './db';

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../supabase/migrations');

/**
 * Applies supabase/migrations in order, once each. For plain Postgres and tests; on Supabase use
 * `supabase db push`, which applies the same files.
 */
export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await db.query<{ name: string }>('select name from schema_migrations')).map((r) => r.name));
  const applied: string[] = [];
  for (const name of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(name)) continue;
    const text = await readFile(join(dir, name), 'utf8');
    await db.tx(async (sql) => {
      await sql.query(text);
      await sql.query('insert into schema_migrations (name) values ($1)', [name]);
    });
    applied.push(name);
  }
  return applied;
}
