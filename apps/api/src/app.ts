import Fastify, { type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { Config } from './config';
import type { Db } from './db/db';
import type { AiProvider } from './ai/provider';
import { loadPrompts, type PromptSet } from './ai/prompts';
import { createTaskRunner } from './ai/runner';
import { AppError, problemHandler } from './http/errors';
import { makeRouter } from './http/route';
import { registerSecurityHeaders } from './http/security';
import type { JobHandlers } from './queue/queue';
import type { ObjectStore } from './storage/object-store';
import { analyticsRoutes } from './modules/analytics/analytics';
import { candidateRoutes, createResumeParser } from './modules/candidate/candidate';
import { extractText, type Extractor } from './modules/candidate/extractor';
import { createProfiler } from './modules/candidate/profiler';
import { careerRoutes, createRecommender } from './modules/careers/careers';
import { catalogRoutes } from './modules/catalog/catalog';
import { createEvaluationJobs, evaluationRoutes } from './modules/evaluation/evaluation';
import { createEvaluator } from './modules/evaluation/evaluator';
import { historyRoutes } from './modules/history/history';
import { createTokenVerifier, identityRoutes, registerAuth, type TokenVerifier } from './modules/identity/identity';
import { createEngine } from './modules/interview/engine';
import { SessionBus } from './modules/interview/events';
import { createInterviewer } from './modules/interview/interviewer';
import { interviewRoutes } from './modules/interview/routes';
import { reportRoutes } from './modules/reports/reports';
import { registerSchedulerRoutes, sandboxRoutes } from './modules/sandbox/sandbox';

export interface AppDeps {
  config: Config;
  db: Db;
  provider: AiProvider;
  store: ObjectStore;
  extract?: Extractor;
  verify?: TokenVerifier;
  prompts?: PromptSet;
  logger?: FastifyServerOptions['logger'];
}

const STAGE_DEADLINE_GRACE_SEC = 30;

/** Never log credentials, resume text, answers, source code, tests or sandbox output. */
export const REDACT = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-runner-signature"]',
  '*.source', '*.text', '*.resumeText', '*.answer', '*.answers', '*.content',
  '*.input', '*.expected', '*.tests', '*.stdout', '*.stderr', '*.prompt', '*.system',
  '*.apiKey', '*.token', '*.signature',
  // Postgres errors echo row values (resume text, source) in detail/where; PGlite adds the query and params.
  'err.detail', 'err.where', 'err.hint', 'err.internalQuery', 'err.query', 'err.params',
  // Secrets, should a config object ever be logged.
  '*.ANTHROPIC_API_KEY', '*.SUPABASE_SERVICE_ROLE_KEY', '*.SUPABASE_JWT_SECRET', '*.DATABASE_URL',
];

/** Request body cap. Resume files go straight to storage; the largest JSON body is a code submission. */
export const BODY_LIMIT_BYTES = 256 * 1024;

export function loggerOptions(config: Config): FastifyServerOptions['logger'] {
  return { level: config.LOG_LEVEL, redact: { paths: REDACT, censor: '[redacted]' } };
}

export async function buildApp(deps: AppDeps) {
  const { config, db, provider, store } = deps;
  const logger = deps.logger ?? loggerOptions(config);
  const app = Fastify({ logger, bodyLimit: BODY_LIMIT_BYTES, trustProxy: config.TRUST_PROXY });
  registerSecurityHeaders(app, config.NODE_ENV === 'production');
  app.setErrorHandler(problemHandler);
  app.setNotFoundHandler((req, reply) => problemHandler(new AppError(404, 'not_found', 'Not found', 'no such route'), req, reply));

  const prompts = deps.prompts ?? loadPrompts();
  const run = createTaskRunner({ provider, db, prompts, config, log: app.log });
  const bus = new SessionBus();
  const interviewer = createInterviewer(run);
  const evaluator = createEvaluator(run, { disagreementThreshold: config.AI_DISAGREEMENT_THRESHOLD });
  const engine = createEngine({ db, interviewer, bus });

  await app.register(cors, { origin: config.CORS_ORIGINS, credentials: false });
  registerAuth(app, db, deps.verify ?? createTokenVerifier(config));
  // Runs after auth (preHandler), so limits key on the verified user rather than a spoofable header.
  await app.register(rateLimit, {
    global: true,
    hook: 'preHandler',
    max: config.RATE_LIMIT_GLOBAL_PER_MIN,
    timeWindow: 60_000,
    keyGenerator: (req) => req.user?.id ?? req.ip,
    errorResponseBuilder: (_req, ctx) =>
      Object.assign(new AppError(429, 'rate_limited', 'Too many requests', `retry in ${Math.ceil(ctx.ttl / 1000)}s`), {
        statusCode: 429,
        headers: { 'retry-after': String(Math.ceil(ctx.ttl / 1000)) },
      }),
  });

  app.get('/health', { config: { public: true, rateLimit: false } }, async () => ({ ok: true }));

  const route = makeRouter(app, config);
  identityRoutes(route, { db, store, config });
  catalogRoutes(route, { db, promptExists: (ref) => prompts.has(`interviewer/${ref}`) });
  candidateRoutes(route, { db, store });
  interviewRoutes(route, { db, engine, bus });
  sandboxRoutes(route, { db, graceSec: STAGE_DEADLINE_GRACE_SEC });
  evaluationRoutes(route, { db });
  reportRoutes(route, { db });
  careerRoutes(route, { db });
  historyRoutes(route, { db });
  analyticsRoutes(route, { db });

  // Scheduler contract on a separate listener, bound to the private network only.
  const internal = Fastify({ logger, bodyLimit: 64 * 1024 });
  internal.setErrorHandler(problemHandler);
  registerSchedulerRoutes(internal, db);

  const evaluation = createEvaluationJobs({ db, evaluator, reviewMinWeight: config.AI_REVIEW_MIN_STAGE_WEIGHT, runWaitMs: config.RUN_RESULT_WAIT_MS });
  const jobs: JobHandlers = {
    parse_resume: createResumeParser({ db, store, extract: deps.extract ?? extractText, profiler: createProfiler(run), log: app.log }),
    evaluate_stage: evaluation.evaluateStage,
    finalize_evaluation: evaluation.finalizeEvaluation,
    recommend: createRecommender({ db, run }),
  };

  return { app, internal, jobs, bus };
}
