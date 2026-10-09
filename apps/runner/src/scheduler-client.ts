import { createPrivateKey, sign, type KeyObject } from 'node:crypto';
import {
  HeartbeatResponse,
  LeaseResponse,
  RUNNER_AUTH_SCHEME,
  RUNNER_ID_HEADER,
  RUNNER_SIG_HEADER,
  RUNNER_TS_HEADER,
  canonicalResult,
  canonicalRunnerRequest,
  type LeasedJob,
  type RunnerRequestPurpose,
  type RunnerResult,
  type SignedRunnerResult,
} from '@ai-interview/shared';

export interface SchedulerClientOptions {
  baseUrl: string;
  runnerId: string;
  privateKeyPem: string;
  credential: string;
  fetch?: typeof fetch;
}

/** Outbound-only client for the scheduler contract (packages/shared/src/sandbox.ts). */
export class SchedulerClient {
  private readonly key: KeyObject;
  private readonly fetch: typeof fetch;
  private lastTs = 0;

  constructor(private readonly o: SchedulerClientOptions) {
    this.key = createPrivateKey(o.privateKeyPem);
    this.fetch = o.fetch ?? fetch;
  }

  private signBytes = (message: string) => sign(null, Buffer.from(message), this.key).toString('base64');

  private post(path: string, purpose: RunnerRequestPurpose | null, fields: string[], body: unknown): Promise<Response> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `${RUNNER_AUTH_SCHEME} ${this.o.credential}`,
      [RUNNER_ID_HEADER]: this.o.runnerId,
    };
    if (purpose) {
      // The API accepts only strictly increasing timestamps per runner.
      const ts = (this.lastTs = Math.max(Date.now(), this.lastTs + 1));
      headers[RUNNER_TS_HEADER] = String(ts);
      headers[RUNNER_SIG_HEADER] = this.signBytes(canonicalRunnerRequest(purpose, this.o.runnerId, ts, fields));
    }
    return this.fetch(new URL(path, this.o.baseUrl), { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  }

  async lease(): Promise<LeasedJob | null> {
    const res = await this.post('/internal/scheduler/lease', 'lease', [], {});
    if (!res.ok) throw new Error(`lease failed: ${res.status}`);
    return LeaseResponse.parse(await res.json()).job;
  }

  async heartbeat(jobId: string, leaseId: string): Promise<HeartbeatResponse> {
    const res = await this.post('/internal/scheduler/heartbeat', 'heartbeat', [jobId, leaseId], { jobId, leaseId });
    if (!res.ok) throw new Error(`heartbeat failed: ${res.status}`);
    return HeartbeatResponse.parse(await res.json());
  }

  /** 409 means the lease is gone and 400 an inconsistent result; neither is retried. */
  async submit(result: RunnerResult): Promise<'accepted' | 'rejected'> {
    const signed: SignedRunnerResult = { result, signature: this.signBytes(canonicalResult(result)) };
    const res = await this.post('/internal/scheduler/results', null, [], signed);
    if (res.status === 204) return 'accepted';
    if (res.status === 409 || res.status === 400) return 'rejected';
    throw new Error(`submit failed: ${res.status}`);
  }
}
