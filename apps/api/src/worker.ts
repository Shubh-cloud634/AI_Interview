import { buildApp } from './app';
import { loadConfig } from './config';
import { productionDeps } from './deps';
import { startWorkers } from './queue/queue';

// Worker-only process: same job handlers, no HTTP listeners.
const config = loadConfig();
const deps = productionDeps(config);
const { app, jobs } = await buildApp(deps);
const stop = startWorkers(deps.db, jobs, app.log);
app.log.info('workers started');

const shutdown = async () => {
  await stop();
  await deps.db.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
