import { readFileSync } from 'node:fs';
import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SCHEDULER_URL: z.url(),
  RUNNER_ID: z.uuid({ error: 'RUNNER_ID must be the uuid printed by register-runner.sh' }),
  RUNNER_PRIVATE_KEY_FILE: z.string().min(1),
  RUNNER_CREDENTIAL_FILE: z.string().min(1),
  RUNNER_HEARTBEAT_FILE: z.string().default('/tmp/runner-heartbeat'),
  SANDBOX_ADAPTER: z.enum(['docker', 'gvisor']).default('docker'),
  RUNNER_ALLOW_ROOTFUL_DOCKER: z.stringbool().default(false),
  RUNNER_SECCOMP_PROFILE: z.string().default('seccomp/runner-seccomp.json'),
  RUNNER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
  RUNNER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(1000),
});

export interface RunnerConfig extends Omit<z.infer<typeof Env>, 'RUNNER_PRIVATE_KEY_FILE' | 'RUNNER_CREDENTIAL_FILE'> {
  privateKeyPem: string;
  credential: string;
}

/** Fails closed: a missing id, key or credential stops the process before it polls anything. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): RunnerConfig {
  const { RUNNER_PRIVATE_KEY_FILE, RUNNER_CREDENTIAL_FILE, ...rest } = Env.parse(env);
  const credential = readFileSync(RUNNER_CREDENTIAL_FILE, 'utf8').trim();
  if (!credential) throw new Error('runner credential file is empty');
  return { ...rest, privateKeyPem: readFileSync(RUNNER_PRIVATE_KEY_FILE, 'utf8'), credential };
}
