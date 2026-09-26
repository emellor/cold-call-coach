import type { ScenarioCatalog } from '@ccc/contracts';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type pg from 'pg';
import { ZodError } from 'zod';
import type { Config } from './config.ts';
import type { Db } from './db/client.ts';
import { webDistDir } from './paths.ts';
import { registerCallRoutes } from './routes/calls.ts';
import { registerHealthRoutes } from './routes/health.ts';
import { registerScenarioRoutes } from './routes/scenarios.ts';
import { registerWeb } from './web.ts';

export interface AppDeps {
  config: Config;
  pool: pg.Pool;
  db: Db;
  /** The validated scenarios/ files. The scenarios themselves are read back from the table. */
  catalog: ScenarioCatalog;
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

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: 'Invalid request', details: error.issues });
    }
    const status =
      typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
    if (status >= 500) request.log.error({ err: error }, 'request failed');
    const message = error instanceof Error ? error.message : String(error);
    return reply.code(status).send({ error: status >= 500 ? 'Internal server error' : message });
  });

  registerHealthRoutes(app, deps.pool);
  registerScenarioRoutes(app, deps);
  registerCallRoutes(app, deps);
  await registerWeb(app, options.webDistDir ?? webDistDir);

  return app;
}
