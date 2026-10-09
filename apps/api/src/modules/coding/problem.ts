import type { QuestionBody, RunStatus, RunSuite, SubmissionResult, TestCase } from '@ai-interview/shared';

/**
 * A coding problem is a question_templates row of kind `coding` whose body is a QuestionBody, authored
 * and published through the normal pack flow. This file is the only place that decides which parts of
 * it a candidate may see.
 */

/** Stored per-test row in run_results.per_test. Names, hidden flags and weights come from the problem, never from the runner. */
export interface StoredTest {
  id: string;
  name: string;
  hidden: boolean;
  weight: number;
  status: RunStatus;
  passed: boolean;
  timeMs: number;
  memKb: number;
}

export interface SuiteTest {
  /** Positional and opaque (`v0`, `h3`): the runner learns counts and visibility, never names. */
  id: string;
  hidden: boolean;
  t: TestCase;
}

/** The visible suite is the sample tests; the full (graded) suite adds the hidden ones. */
export function testsForSuite(body: QuestionBody, suite: RunSuite): SuiteTest[] {
  const visible = (body.tests?.visible ?? []).map((t, i) => ({ id: `v${i}`, hidden: false, t }));
  const hidden = suite === 'full' ? (body.tests?.hidden ?? []).map((t, i) => ({ id: `h${i}`, hidden: true, t })) : [];
  return [...visible, ...hidden];
}

export function languageAllowed(body: QuestionBody | null, slug: string): boolean {
  return !body?.languages || body.languages.includes(slug);
}

export type CandidateRunView = NonNullable<SubmissionResult['result']>;

/**
 * The only shape of a run result a candidate ever sees. Hidden tests are reduced to two counts: no
 * names, inputs, expected outputs, per-test status or timings. Built field by field from an allowlist
 * so a new stored field cannot leak by default.
 */
export function candidateView(res: { status: RunStatus; per_test: StoredTest[]; stdout: string; stderr: string }): CandidateRunView {
  const hidden = res.per_test.filter((t) => t.hidden);
  return {
    status: res.status,
    perTest: res.per_test.filter((t) => !t.hidden).map((t) => ({ name: t.name, passed: t.passed, timeMs: t.timeMs, memKb: t.memKb })),
    hiddenPassed: hidden.length ? hidden.filter((t) => t.passed).length : null,
    hiddenTotal: hidden.length ? hidden.length : null,
    stdout: res.stdout,
    stderr: res.stderr,
  };
}
