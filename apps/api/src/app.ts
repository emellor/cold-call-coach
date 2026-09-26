import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type pg from 'pg';
import type { Config } from './config.ts';
import type { Db } from './db/client.ts';
import { webDistDir } from './paths.ts';
import { registerHealthRoutes } from './routes/health.ts';
import { registerWeb } from './web.ts';

export interface AppDeps {
  config: Config;
  pool: pg.Pool;
  db: Db;
}

export interface BuildAppOptions {
  logger?: FastifyServerOptions['logger'];
  /** Where the built SPA lives; tests point this at a fixture or a missing dir. */
  webDistDir?: string;
}

export async function buildApp(
  deps: AppDeps,
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  registerHealthRoutes(app, deps.pool);
  await registerWeb(app, options.webDistDir ?? webDistDir);

  return app;
}
