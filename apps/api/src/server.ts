import type { PriceTable, ScenarioCatalog } from '@ccc/contracts';
import { buildApp } from './app.ts';
import { sweepStaleCalls } from './calls/sweep.ts';
import { ConfigError, loadConfig, loadDotEnv, type Config } from './config.ts';
import { createDb } from './db/client.ts';
import { scenariosDir } from './paths.ts';
import { PriceTableError, readPriceTable } from './prices.ts';
import { ScenarioFilesError, readScenarioCatalog, syncScenarios } from './scenarios.ts';

/** How often boot retries the scenario upsert while the database is unreachable. */
const SYNC_RETRY_MS = 5_000;
/** How often calls that never reported back are marked failed. */
const SWEEP_MS = 5 * 60_000;

loadDotEnv();

let config: Config;
let catalog: ScenarioCatalog;
let prices: PriceTable;
try {
  config = loadConfig(process.env);
  catalog = await readScenarioCatalog(scenariosDir);
  prices = await readPriceTable();
} catch (error) {
  if (
    error instanceof ConfigError ||
    error instanceof ScenarioFilesError ||
    error instanceof PriceTableError
  ) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

const { pool, db } = createDb(config.DATABASE_URL);
const app = await buildApp(
  { config, pool, db, catalog, prices },
  {
    logger:
      config.NODE_ENV === 'development'
        ? { level: config.LOG_LEVEL, transport: { target: 'pino-pretty' } }
        : { level: config.LOG_LEVEL },
  },
);

// The API still starts without a database (health reports it), so the upsert
// keeps retrying until Postgres is up and migrated.
let syncTimer: NodeJS.Timeout | undefined;
const sync = async (): Promise<void> => {
  try {
    await syncScenarios(db, catalog.scenarios);
    app.log.info(
      { scenarios: catalog.scenarios.map((s) => `${s.id}@${s.version}`) },
      'scenarios synced',
    );
    const resumed = await app.reviewQueue.resumeUnfinished();
    if (resumed) app.log.info({ resumed }, 'resumed unfinished reviews');
    const demos = await app.demoQueue.resumeUnfinished();
    if (demos) app.log.info({ demos }, 'resumed demo calls a restart interrupted');
  } catch (error) {
    app.log.error(
      { err: error },
      `could not store the scenarios (is Postgres up, and has \`pnpm db:migrate\` run?); retrying in ${SYNC_RETRY_MS / 1000}s`,
    );
    syncTimer = setTimeout(() => void sync(), SYNC_RETRY_MS).unref();
  }
};
await sync();

const sweep = async (): Promise<void> => {
  try {
    const swept = await sweepStaleCalls(db);
    if (swept) app.log.warn({ swept }, 'marked calls that never reported back as failed');
  } catch (error) {
    app.log.error({ err: error }, 'could not sweep stale calls');
  }
};
await sweep();
const sweepTimer = setInterval(() => void sweep(), SWEEP_MS).unref();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    clearTimeout(syncTimer);
    clearInterval(sweepTimer);
    void app
      .close()
      .then(() => pool.end())
      .finally(() => process.exit(0));
  });
}

await app.listen({ host: config.HOST, port: config.PORT });
