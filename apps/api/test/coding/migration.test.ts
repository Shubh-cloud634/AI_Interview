import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db';

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => db?.close());

describe('coding migration', () => {
  it('seeds languages with limits and a separate compile step', async () => {
    const rows = await db.query<{ slug: string; compile_cmd: string; limits: { wallMs: number }; enabled: boolean }>(
      'select slug, compile_cmd, limits, enabled from languages order by slug',
    );
    expect(rows.map((r) => r.slug)).toEqual(['javascript', 'python']);
    for (const r of rows) {
      expect(r.compile_cmd).toBeTruthy();
      expect(r.limits.wallMs).toBeGreaterThan(0);
      expect(r.enabled).toBe(true);
    }
  });

  it('app_user cannot write run results or edit leases (second wall behind the API)', async () => {
    const privs = await db.query<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
       where grantee = 'app_user' and table_name in ('run_results', 'run_jobs', 'code_submissions')`,
    );
    const has = (t: string, p: string) => privs.some((r) => r.table_name === t && r.privilege_type === p);
    expect(has('run_results', 'INSERT') || has('run_results', 'UPDATE') || has('run_results', 'DELETE')).toBe(false);
    expect(has('run_jobs', 'UPDATE') || has('run_jobs', 'DELETE')).toBe(false);
    expect(has('code_submissions', 'UPDATE') || has('code_submissions', 'DELETE')).toBe(false);
    expect(has('run_jobs', 'INSERT') && has('code_submissions', 'INSERT')).toBe(true);
  });
});
