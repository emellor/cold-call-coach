import Anthropic from '@anthropic-ai/sdk';
import type { ScenarioCatalog } from '@ccc/contracts';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type pg from 'pg';
import { ZodError } from 'zod';
import type { Config } from './config.ts';
import type { Db } from './db/client.ts';
import { webDistDir } from './paths.ts';
import { ReviewQueue } from './review/queue.ts';
import { type Reviewer, claudeReviewer } from './review/reviewer.ts';
import { registerCallLogRoutes } from './routes/callLog.ts';
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
  /**
   * Writes reviews. Omitted: Claude on REVIEW_MODEL, or none without
   * ANTHROPIC_API_KEY (reviews then fail, saying so). Tests pass a stub.
   */
  reviewer?: Reviewer | null;
}

declare module 'fastify' {
  interface FastifyInstance {
    reviewQueue: ReviewQueue;
  }
}

function defaultReviewer(config: Config): Reviewer | null {
  if (!config.ANTHROPIC_API_KEY) return null;
  return claudeReviewer({
    messages: new Anthropic({ apiKey: config.ANTHROPIC_API_KEY }).beta.messages,
    model: config.REVIEW_MODEL,
    effort: config.REVIEW_EFFORT,
  });
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

  const queue = new ReviewQueue({
    db: deps.db,
    catalog: deps.catalog,
    reviewer: deps.reviewer === undefined ? defaultReviewer(deps.config) : deps.reviewer,
    logger: app.log,
  });
  app.decorate('reviewQueue', queue);

  registerHealthRoutes(app, deps.pool);
  registerScenarioRoutes(app, deps);
  registerCallRoutes(app, deps, queue);
  registerCallLogRoutes(app, deps, queue);
  await registerWeb(app, options.webDistDir ?? webDistDir);

  return app;
}
