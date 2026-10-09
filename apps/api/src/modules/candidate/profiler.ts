import { z } from 'zod';
import type { AiContext, TaskDef, TaskRunner } from '../../ai/runner';
import { isGrounded, normalizeLoose } from '../../ai/untrusted';

/** Resume understanding. Every stored field must be grounded in the resume text; ungrounded items are dropped. */

const short = (n: number) => z.string().trim().min(1).max(n);
const optionalShort = (n: number) => z.string().trim().max(n).nullable();

export const ProfileDraft = z.object({
  headline: optionalShort(300),
  summary: optionalShort(2000),
  experiences: z
    .array(z.object({ org: short(200), title: short(200), start: optionalShort(40), end: optionalShort(40), description: optionalShort(2000) }))
    .max(30),
  education: z
    .array(z.object({ institution: short(200), degree: optionalShort(200), field: optionalShort(200), start: optionalShort(40), end: optionalShort(40) }))
    .max(15),
  skills: z.array(z.object({ name: short(80), level: z.int().min(1).max(5).nullable(), span: short(300) })).max(80),
});
export type ProfileDraft = z.infer<typeof ProfileDraft>;

export interface GroundedProfile {
  headline: string | null;
  summary: string | null;
  experiences: ProfileDraft['experiences'];
  education: ProfileDraft['education'];
  skills: { name: string; level: number | null; evidence: string[] }[];
  dropped: { experiences: number; education: number; skills: number; fields: number };
}

const extractProfileTask: TaskDef<{ resumeText: string }, ProfileDraft> = {
  role: 'candidate',
  task: 'extractProfile',
  promptRef: () => 'candidate/extract-profile.v1',
  tier: 'primary',
  effort: 'low',
  maxTokens: 8000,
  vars: () => ({}),
  data: (i) => ({ resume: i.resumeText }),
  maxDataChars: 60_000,
  output: () => ProfileDraft,
};

/** Pure: keeps only what the resume text supports. */
export function groundProfile(draft: ProfileDraft, text: string): GroundedProfile {
  const dropped = { experiences: 0, education: 0, skills: 0, fields: 0 };
  const field = (v: string | null) => {
    if (v === null) return null;
    if (isGrounded(v, text)) return v;
    dropped.fields++;
    return null;
  };
  const experiences = draft.experiences.flatMap((e) => {
    if (!isGrounded(e.org, text) || !isGrounded(e.title, text)) {
      dropped.experiences++;
      return [];
    }
    return [{ org: e.org, title: e.title, start: field(e.start), end: field(e.end), description: field(e.description) }];
  });
  const education = draft.education.flatMap((e) => {
    if (!isGrounded(e.institution, text)) {
      dropped.education++;
      return [];
    }
    return [{ institution: e.institution, degree: field(e.degree), field: field(e.field), start: field(e.start), end: field(e.end) }];
  });
  const seen = new Set<string>();
  const skills = draft.skills.flatMap((s) => {
    const key = normalizeLoose(s.name);
    if (seen.has(key) || !isGrounded(s.span, text) || !isGrounded(s.name, s.span)) {
      dropped.skills++;
      return [];
    }
    seen.add(key);
    return [{ name: s.name, level: s.level, evidence: [s.span] }];
  });
  // Headline and summary are model-written prose, so they cannot be verbatim. They may still not name
  // anything the resume does not: a fabricated employer must not survive here after its row was dropped.
  const prose = (v: string | null) => {
    if (v === null) return null;
    if (properNouns(v).every((w) => isGrounded(w, text))) return v;
    dropped.fields++;
    return null;
  };
  return { headline: prose(draft.headline), summary: prose(draft.summary), experiences, education, skills, dropped };
}

/** Capitalized words that do not open a sentence: the names of employers, schools, products and places. */
function properNouns(s: string): string[] {
  return s
    .split(/(?<=[.!?:;])\s+|\n+/)
    .flatMap((sentence) => sentence.trim().split(/\s+/).slice(1))
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}+#]+$/gu, ''))
    .filter((w) => /^\p{Lu}/u.test(w));
}

export function createProfiler(run: TaskRunner) {
  return {
    async extract(ctx: AiContext, resumeText: string) {
      const res = await run(extractProfileTask, { resumeText }, ctx);
      return { profile: groundProfile(res.output, resumeText), injectionFlags: res.injectionFlags };
    },
  };
}
export type Profiler = ReturnType<typeof createProfiler>;
