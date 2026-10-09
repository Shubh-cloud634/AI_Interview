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

const PROGRAMMING = [
  'python', 'java', 'javascript', 'typescript', 'c++', 'c#', 'c', 'go', 'golang', 'rust', 'kotlin', 'swift', 'php', 'ruby', 'scala', 'r',
  'sql', 'algorithms', 'data structures', 'leetcode', 'dsa',
];

export type InterviewSuggestion = { type: 'technical' | 'coding' | 'hr' | 'behavioral'; score: number; reason: string };

/**
 * Ranks the four interview types for this candidate from what their resume shows and where they are weakest.
 * Plain rules, so every suggestion can say why. Returns [] without a profile.
 */
export function suggestInterviewTypes(profile: Profile | null | undefined, gapNames: string[]): InterviewSuggestion[] {
  if (!profile) return [];
  const skills = profile.skills.map((s) => s.name.trim());
  const lower = skills.map((s) => s.toLowerCase());
  const code = skills.filter((_, i) => PROGRAMMING.includes(lower[i]!));
  const roles = profile.experiences.length;
  const gaps = gapNames.map((g) => g.toLowerCase());
  const gap = (...words: string[]) => gapNames.find((_, i) => words.some((w) => gaps[i]!.includes(w)));
  const list = (xs: string[]) => xs.slice(0, 3).join(', ');

  const codeGap = gap('problem', 'code');
  const designGap = gap('system', 'design');
  const commGap = gap('communicat');

  const coding: InterviewSuggestion = {
    type: 'coding',
    score: (code.length >= 2 ? 3 : code.length === 1 ? 1.5 : 0) + (codeGap ? 2 : 0),
    reason: code.length
      ? `You list ${list(code)}. A live coding round shows that off${codeGap ? ` and works on your weaker area, ${codeGap.toLowerCase()}` : ''}.`
      : `Your weaker area is ${codeGap?.toLowerCase()}. A coding round builds it.`,
  };
  const technical: InterviewSuggestion = {
    type: 'technical',
    score: (skills.length >= 6 ? 2.5 : skills.length >= 3 ? 1.5 : 0) + (roles >= 1 ? 1 : 0) + (designGap ? 2 : 0),
    reason: skills.length
      ? `${skills.length} skills on your resume, including ${list(skills)}. Expect questions on how you actually used them${designGap ? `, plus your weaker area, ${designGap.toLowerCase()}` : ''}.`
      : 'Questions on the projects and tools you have worked with.',
  };
  const behavioral: InterviewSuggestion = {
    type: 'behavioral',
    score: (roles >= 2 ? 3 : roles === 1 ? 1.5 : 0) + (commGap ? 2 : 0),
    reason: roles
      ? `${roles} ${roles === 1 ? 'role or project' : 'roles and projects'} give you real stories to tell in STAR form${commGap ? `, and ${commGap.toLowerCase()} is a weaker area` : ''}.`
      : 'Practise telling clear stories about teamwork and setbacks.',
  };
  const hr: InterviewSuggestion = {
    type: 'hr',
    score: (roles === 0 ? 2 : roles === 1 ? 1.5 : 0.5) + (profile.education.length && roles <= 1 ? 0.5 : 0),
    reason: roles <= 1
      ? 'Early in your career, so be ready to explain your motivation, strengths and fit.'
      : 'Be ready to explain your motivation, strengths and why this role.',
  };
  return [coding, technical, behavioral, hr].sort((a, b) => b.score - a.score);
}
