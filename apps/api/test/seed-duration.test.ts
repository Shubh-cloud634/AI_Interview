import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ModeSpec, interviewDurationOk } from '@ai-interview/shared';

describe('seeded modes', () => {
  const sql = readFileSync(resolve(__dirname, '../../../supabase/migrations/20261008000003_seed_packs.sql'), 'utf8');

  it('every seeded mode runs 30 to 40 minutes with each stage timed', () => {
    const found = [...sql.matchAll(/"stages":\s*\[([\s\S]*?)\n\s*\]/g)];
    expect(found.length).toBeGreaterThanOrEqual(3);
    for (const m of found) {
      const spec = ModeSpec.parse(JSON.parse(`{"stages":[${m[1]}]}`));
      expect(interviewDurationOk(spec)).toBe(true);
    }
  });
});
