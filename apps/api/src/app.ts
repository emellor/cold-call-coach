import Anthropic from '@anthropic-ai/sdk';
import type { PriceTable, ScenarioCatalog } from '@ccc/contracts';
import { claudeHeaders } from '@ccc/core';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type pg from 'pg';
import { ZodError } from 'zod';
import { registerAuth } from './auth.ts';
import { type Config, liveKitConfig } from './config.ts';
import type { Db } from './db/client.ts';
import {
  LIVEKIT_REJECTED,
  LiveKitCheck,
  type LiveKitAuthCheck,
  roomServiceProbe,
} from './livekitCheck.ts';
import { webDistDir } from './paths.ts';
import { readPriceTable } from './prices.ts';
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
  /** Omitted: read from config/prices.json. */
  prices?: PriceTable;
  /**
   * Whether LiveKit accepts the key pair, for the health check. Omitted: asks
   * LiveKit itself when it's configured. Tests pass a stub, or null.
   */
  livekitCheck?: LiveKitAuthCheck | null;
}

/** What the routes get: the deps with the price table resolved. */
export type AppContext = Omit<AppDeps, 'prices' | 'livekitCheck'> & { prices: PriceTable };

declare module 'fastify' {
  interface FastifyInstance {
    reviewQueue: ReviewQueue;
  }
}

function defaultReviewer(config: Config, prices: PriceTable): Reviewer | null {
  if (!config.ANTHROPIC_API_KEY) return null;
  return claudeReviewer({
    messages: new Anthropic({
      apiKey: config.ANTHROPIC_API_KEY,
      defaultHeaders: claudeHeaders(config.ANTHROPIC_WORKSPACE_ID),
    }).beta.messages,
    model: config.REVIEW_MODEL,
    effort: config.REVIEW_EFFORT,
    prices,
  });
}

function defaultLiveKitCheck(config: Config, app: FastifyInstance): LiveKitAuthCheck | null {
  const livekit = liveKitConfig(config);
  if ('problem' in livekit) return null;
  return new LiveKitCheck(roomServiceProbe(livekit), {
    onRejected: () => app.log.error(LIVEKIT_REJECTED),
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
  // Behind Render's proxy (production), the client's address is in X-Forwarded-For.
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: deps.config.NODE_ENV === 'production',
  });

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

  const context: AppContext = { ...deps, prices: deps.prices ?? (await readPriceTable()) };
  const reviewer =
    deps.reviewer === undefined ? defaultReviewer(deps.config, context.prices) : deps.reviewer;
  const queue = new ReviewQueue({ db: deps.db, catalog: deps.catalog, reviewer, logger: app.log });
  app.decorate('reviewQueue', queue);

  registerAuth(app, deps.config);
  registerHealthRoutes(app, {
    pool: deps.pool,
    config: deps.config,
    reviewsEnabled: reviewer !== null,
    livekit:
      deps.livekitCheck === undefined ? defaultLiveKitCheck(deps.config, app) : deps.livekitCheck,
  });
  registerScenarioRoutes(app, context);
  registerCallRoutes(app, context, queue);
  registerCallLogRoutes(app, context, queue);
  await registerWeb(app, options.webDistDir ?? webDistDir);

  return app;
}
