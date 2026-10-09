import type { Profile, ReadinessList } from '@ai-interview/shared';

/** Confidence-weighted mean of competency readiness, 0 to 100. Null with no data. */
export function readinessScore(items: ReadinessList['items']): number | null {
  const w = items.reduce((n, i) => n + Math.max(0.05, i.confidence), 0);
  if (!items.length || w === 0) return null;
  return (items.reduce((n, i) => n + i.score * Math.max(0.05, i.confidence), 0) / w) * 100;
}

export function readinessLevel(score: number | null): { label: string; tone: 'neutral' | 'warn' | 'accent' | 'good' } {
  if (score === null) return { label: 'Not assessed', tone: 'neutral' };
  if (score >= 75) return { label: 'Interview ready', tone: 'good' };
  if (score >= 55) return { label: 'Getting there', tone: 'accent' };
  return { label: 'Building foundations', tone: 'warn' };
}

/** Which profile sections are filled, as a 0 to 100 score plus the missing section names. */
export function profileCompleteness(p: Profile | null | undefined): { value: number; missing: string[] } {
  if (!p) return { value: 0, missing: ['Resume', 'Headline', 'Summary', 'Experience', 'Education', 'Skills'] };
  const parts: [string, boolean][] = [
    ['Headline', !!p.headline],
    ['Summary', !!p.summary],
    ['Experience', p.experiences.length > 0],
    ['Education', p.education.length > 0],
    ['Skills', p.skills.length > 0],
  ];
  return { value: (parts.filter(([, ok]) => ok).length / parts.length) * 100, missing: parts.filter(([, ok]) => !ok).map(([n]) => n) };
}

/** Cut-offs are a product choice, shown to the user as labels, never as a promise. */
export function fitBand(fit: number): { label: string; tone: 'good' | 'accent' | 'warn' } {
  if (fit >= 0.75) return { label: 'Strong match', tone: 'good' };
  if (fit >= 0.5) return { label: 'Potential match', tone: 'accent' };
  return { label: 'Requires development', tone: 'warn' };
}

/** Skill data is a fact when it is quoted from the resume or entered by the user, an inference otherwise. */
export function skillCertainty(s: Profile['skills'][number]): 'fact' | 'inference' {
  return s.source === 'manual' || s.evidence.length > 0 ? 'fact' : 'inference';
}

export const label = (slug: string) => slug.replace(/[-_]/g, ' ');

export const greeting = (d = new Date()) => (d.getHours() < 12 ? 'Good morning' : d.getHours() < 18 ? 'Good afternoon' : 'Good evening');

/** Projects are stored as experience rows whose title is the resume section heading, such as "Projects". */
export const isProject = (e: { title: string }) => /^(?:[a-z]+ )?projects?$/i.test(e.title.trim());
