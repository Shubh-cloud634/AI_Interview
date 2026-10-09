import type { Db, Sql } from '../../db/db';
import type { Route } from '../../http/route';
import { codingRoutes } from '../coding/routes';

/**
 * The sandbox module's public interface. The API never runs candidate code (S17, enforced by
 * test/coding/no-exec.test.ts): it writes run_jobs rows, leases them to registered runners
 * (./scheduler.ts) and stores results whose signatures verify. apps/runner executes them.
 */

export { candidateView, testsForSuite } from '../coding/problem';
export { acceptResult, heartbeat, leaseJob, registerSchedulerRoutes, sha256 } from './scheduler';

/** The graded run over visible plus hidden tests, enqueued once when a code turn is submitted. */
export async function enqueueGradedRun(sql: Sql, userId: string, submissionId: string) {
  await sql.query(
    `insert into run_jobs (submission_id, user_id, suite) select $1, $2, 'full'
     where not exists (select 1 from run_jobs where submission_id = $1 and suite = 'full')`,
    [submissionId, userId],
  );
}

/** Candidate-facing coding routes (submissions, practice runs, results). */
export function sandboxRoutes(route: Route, deps: { db: Db; graceSec: number }) {
  codingRoutes(route, deps);
}
