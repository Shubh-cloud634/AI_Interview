import { closeSync, futimesSync, openSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LeasedJob } from '@ai-interview/shared';
import { loadConfig, type RunnerConfig } from './config';
import { DockerSandbox } from './docker-sandbox';
import { internalError, runJob, type HarnessResult } from './harness';
import type { Sandbox } from './sandbox';
import { SchedulerClient } from './scheduler-client';
import { delay } from './supervisor';

const HEARTBEAT_EVERY_MS = 30_000;

/** The runner takes no inbound connections, so liveness is a file the container healthcheck stats. */
function touch(path: string) {
  const fd = openSync(path, 'a');
  const now = new Date();
  futimesSync(fd, now, now);
  closeSync(fd);
}

export async function processJob(client: SchedulerClient, sandbox: Sandbox, runnerId: string, job: LeasedJob): Promise<void> {
  const abort = new AbortController();
  const beat = setInterval(() => {
    client.heartbeat(job.jobId, job.leaseId).then((r) => r.cancel && abort.abort(), () => {});
  }, HEARTBEAT_EVERY_MS);
  let outcome: HarnessResult;
  try {
    outcome = await runJob(job, sandbox, abort.signal);
  } catch {
    // The sandbox or harness failed, not the candidate. The API retries or dead-letters.
    outcome = internalError(job);
  } finally {
    clearInterval(beat);
  }
  if (abort.signal.aborted) return;
  await client.submit({
    jobId: job.jobId, leaseId: job.leaseId, runnerId, nonce: job.nonce, sourceSha256: job.sourceSha256, ...outcome,
  });
}

function buildSandbox(c: RunnerConfig): Sandbox {
  return new DockerSandbox({
    seccompProfile: resolve(c.RUNNER_SECCOMP_PROFILE),
    runtime: c.SANDBOX_ADAPTER === 'gvisor' ? 'runsc' : undefined,
    allowRootful: c.RUNNER_ALLOW_ROOTFUL_DOCKER,
    production: c.NODE_ENV === 'production',
  });
}

async function main() {
  const c = loadConfig();
  const sandbox = buildSandbox(c);
  await sandbox.preflight();
  const client = new SchedulerClient({ baseUrl: c.SCHEDULER_URL, runnerId: c.RUNNER_ID, privateKeyPem: c.privateKeyPem, credential: c.credential });

  let stopping = false;
  for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => (stopping = true));

  const worker = async () => {
    while (!stopping) {
      try {
        const job = await client.lease();
        touch(c.RUNNER_HEARTBEAT_FILE);
        if (!job) {
          await delay(c.RUNNER_POLL_INTERVAL_MS);
          continue;
        }
        await processJob(client, sandbox, c.RUNNER_ID, job);
      } catch (err) {
        console.error('runner loop error:', err instanceof Error ? err.message : 'unknown');
        await delay(c.RUNNER_POLL_INTERVAL_MS * 2);
      }
    }
  };
  await Promise.all(Array.from({ length: c.RUNNER_CONCURRENCY }, worker));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('runner failed to start:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
