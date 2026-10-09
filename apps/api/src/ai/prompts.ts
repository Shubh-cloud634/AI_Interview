import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PROMPTS_DIR } from '@ai-interview/prompts';

/** `role/name.vN` -> template text. Loaded once; data never names a file path directly. */
export type PromptSet = ReadonlyMap<string, string>;

export function loadPrompts(dir = PROMPTS_DIR): PromptSet {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/^[a-z0-9-]+\.v\d+\.md$/.test(entry.name)) {
        out.set(relative(dir, p).replace(/\\/g, '/').replace(/\.md$/, ''), readFileSync(p, 'utf8'));
      }
    }
  };
  walk(dir);
  return out;
}

/** Fills {{name}} placeholders with trusted values only. Unknown placeholders are an authoring bug. */
export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    const v = vars[k];
    if (v === undefined) throw new Error(`prompt variable ${k} not provided`);
    return v;
  });
}
