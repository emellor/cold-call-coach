import { buildApp } from './app.ts';
import { ConfigError, loadConfig, loadDotEnv, type Config } from './config.ts';
import { createDb } from './db/client.ts';

loadDotEnv();

let config: Config;
try {
  config = loadConfig(process.env);
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

const { pool, db } = createDb(config.DATABASE_URL);
const app = await buildApp(
  { config, pool, db },
  {
    logger:
      config.NODE_ENV === 'development'
        ? { level: config.LOG_LEVEL, transport: { target: 'pino-pretty' } }
        : { level: config.LOG_LEVEL },
  },
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void app
      .close()
      .then(() => pool.end())
      .finally(() => process.exit(0));
  });
}

await app.listen({ host: config.HOST, port: config.PORT });
