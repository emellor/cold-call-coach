import Anthropic from '@anthropic-ai/sdk';
import type { PriceTable, ScenarioCatalog } from '@ccc/contracts';
import { claudeHeaders } from '@ccc/core';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type pg from 'pg';
import { ZodError } from 'zod';
import { registerAuth } from './auth.ts';
import { type CheatSheetWriter, claudeCheatSheetWriter } from './cheatSheets/writer.ts';
import { type Config, liveKitConfig } from './config.ts';
import type { Db } from './db/client.ts';
import { DemoQueue } from './demos/queue.ts';
import { type DemoWriter, claudeDemoWriter } from './demos/writer.ts';
import {
  LIVEKIT_REJECTED,
  LiveKitCheck,
  type LiveKitAuthCheck,
  roomServiceProbe,
} from './livekitCheck.ts';
import { webDistDir } from './paths.ts';
import { readPriceTable } from './prices.ts';
import { cartesiaVoiceLibrary } from './prospects/voices.ts';
import { type ProspectWriter, claudeProspectWriter } from './prospects/writer.ts';
import { type RepNoter, claudeRepNoter } from './review/noter.ts';
import { ReviewQueue } from './review/queue.ts';
import { type Reviewer, claudeReviewer } from './review/reviewer.ts';
import { registerCallLogRoutes } from './routes/callLog.ts';
import { registerCallRoutes } from './routes/calls.ts';
import { registerCheatSheetRoutes } from './routes/cheatSheets.ts';
import { registerDemoRoutes } from './routes/demos.ts';
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
  /**
   * Writes a reverse call's notes on Sam's lines. Omitted: Claude on REVIEW_MODEL,
   * or none without ANTHROPIC_API_KEY (like the reviewer). Tests pass a stub.
   */
  repNoter?: RepNoter | null;
  /**
   * Writes "Add new" prospects. Omitted: Claude on REVIEW_MODEL, with voices
   * from Cartesia when CARTESIA_API_KEY is set, or none without
   * ANTHROPIC_API_KEY. Tests pass a stub.
   */
  prospectWriter?: ProspectWriter | null;
  /**
   * Writes demo calls. Omitted: Claude on REVIEW_MODEL, or none without
   * ANTHROPIC_API_KEY (generating them is then refused, saying why). Tests
   * pass a stub.
   */
  demoWriter?: DemoWriter | null;
  /**
   * Writes cheat sheets. Omitted: Claude on REVIEW_MODEL, or none without
   * ANTHROPIC_API_KEY (writing one is then refused, saying why). Tests pass a stub.
   */
  cheatSheetWriter?: CheatSheetWriter | null;
  /** Omitted: read from config/prices.json. */
  prices?: PriceTable;
  /**
   * Whether LiveKit accepts the key pair, for the health check. Omitted: asks
   * LiveKit itself when it's configured. Tests pass a stub, or null.
   */
  livekitCheck?: LiveKitAuthCheck | null;
}

/** What the routes get: the deps with the price table resolved. */
export type AppContext = Omit<
  AppDeps,
  'prices' | 'livekitCheck' | 'prospectWriter' | 'demoWriter' | 'cheatSheetWriter' | 'repNoter'
> & {
  prices: PriceTable;
};

declare module 'fastify' {
  interface FastifyInstance {
    reviewQueue: ReviewQueue;
    demoQueue: DemoQueue;
  }
}

const claudeFor = (apiKey: string, config: Config) =>
  new Anthropic({ apiKey, defaultHeaders: claudeHeaders(config.ANTHROPIC_WORKSPACE_ID) });

function defaultReviewer(config: Config, prices: PriceTable): Reviewer | null {
  if (!config.ANTHROPIC_API_KEY) return null;
  return claudeReviewer({
    messages: claudeFor(config.ANTHROPIC_API_KEY, config).beta.messages,
    model: config.REVIEW_MODEL,
    effort: config.REVIEW_EFFORT,
    prices,
  });
}

function defaultRepNoter(config: Config, prices: PriceTable): RepNoter | null {
  if (!config.ANTHROPIC_API_KEY) return null;
  return claudeRepNoter({
    messages: claudeFor(config.ANTHROPIC_API_KEY, config).beta.messages,
    model: config.REVIEW_MODEL,
    prices,
  });
}

function defaultProspectWriter(
  deps: AppDeps,
  prices: PriceTable,
  logger: FastifyInstance['log'],
): ProspectWriter | null {
  const { config } = deps;
  if (!config.ANTHROPIC_API_KEY) return null;
  return claudeProspectWriter({
    messages: claudeFor(config.ANTHROPIC_API_KEY, config).beta.messages,
    model: config.REVIEW_MODEL,
    catalog: deps.catalog,
    voices: config.CARTESIA_API_KEY
      ? cartesiaVoiceLibrary({ apiKey: config.CARTESIA_API_KEY })
      : null,
    prices,
    logger,
  });
}

function defaultDemoWriter(
  deps: AppDeps,
  prices: PriceTable,
  logger: FastifyInstance['log'],
): DemoWriter | null {
  const { config } = deps;
  if (!config.ANTHROPIC_API_KEY) return null;
  return claudeDemoWriter({
    messages: claudeFor(config.ANTHROPIC_API_KEY, config).beta.messages,
    model: config.REVIEW_MODEL,
    product: deps.catalog.product,
    rubrics: deps.catalog.rubrics,
    prices,
    logger,
  });
}

function defaultCheatSheetWriter(
  deps: AppDeps,
  prices: PriceTable,
  logger: FastifyInstance['log'],
): CheatSheetWriter | null {
  const { config } = deps;
  if (!config.ANTHROPIC_API_KEY) return null;
  return claudeCheatSheetWriter({
    messages: claudeFor(config.ANTHROPIC_API_KEY, config).beta.messages,
    model: config.REVIEW_MODEL,
    product: deps.catalog.product,
    rubrics: deps.catalog.rubrics,
    prices,
    logger,
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
  const noter =
    deps.repNoter === undefined ? defaultRepNoter(deps.config, context.prices) : deps.repNoter;
  const queue = new ReviewQueue({
    db: deps.db,
    catalog: deps.catalog,
    reviewer,
    noter,
    logger: app.log,
  });
  app.decorate('reviewQueue', queue);
  const demoQueue = new DemoQueue({
    db: deps.db,
    writer:
      deps.demoWriter === undefined
        ? defaultDemoWriter(deps, context.prices, app.log)
        : deps.demoWriter,
    logger: app.log,
  });
  app.decorate('demoQueue', demoQueue);

  registerAuth(app, deps.config);
  registerHealthRoutes(app, {
    pool: deps.pool,
    config: deps.config,
    reviewsEnabled: reviewer !== null,
    livekit:
      deps.livekitCheck === undefined ? defaultLiveKitCheck(deps.config, app) : deps.livekitCheck,
  });
  // "Add new", and "Practise this call" on a demo from a brief.
  const prospectWriter =
    deps.prospectWriter === undefined
      ? defaultProspectWriter(deps, context.prices, app.log)
      : deps.prospectWriter;
  registerScenarioRoutes(app, context, prospectWriter);
  registerCallRoutes(app, context, queue);
  registerCallLogRoutes(app, context, queue);
  registerDemoRoutes(app, context, demoQueue, prospectWriter);
  registerCheatSheetRoutes(
    app,
    context,
    deps.cheatSheetWriter === undefined
      ? defaultCheatSheetWriter(deps, context.prices, app.log)
      : deps.cheatSheetWriter,
  );
  await registerWeb(app, options.webDistDir ?? webDistDir);

  return app;
}
