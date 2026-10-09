import { buildApp } from './app';
import { loadConfig } from './config';
import { productionDeps } from './deps';
import { startWorkers } from './queue/queue';

const config = loadConfig();
const deps = productionDeps(config);
const { app, internal, jobs } = await buildApp(deps);

const stopWorkers = config.WORKERS_ENABLED ? startWorkers(deps.db, jobs, app.log) : async () => {};
await app.listen({ host: config.HOST, port: config.PORT });
await internal.listen({ host: config.INTERNAL_HOST, port: config.INTERNAL_PORT });

const shutdown = async () => {
  await Promise.allSettled([app.close(), internal.close()]);
  await stopWorkers();
  await deps.db.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
