import { HealthResponse } from '@ccc/contracts';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { type Config, liveKitConfig } from '../config.ts';

/** What this API's settings allow, for the page to warn about before a call. */
export function features(config: Config, reviewsEnabled: boolean): HealthResponse['features'] {
  const livekit = liveKitConfig(config);
  return {
    calls:
      'missing' in livekit
        ? { ok: false, reason: `Calls are off: set ${livekit.missing.join(', ')} on the API.` }
        : { ok: true },
    reviews: reviewsEnabled
      ? { ok: true }
      : { ok: false, reason: 'Reviews are off: set ANTHROPIC_API_KEY on the API.' },
  };
}

export function registerHealthRoutes(
  app: FastifyInstance,
  deps: { pool: pg.Pool; config: Config; reviewsEnabled: boolean },
): void {
  const settings = features(deps.config, deps.reviewsEnabled);
  app.get('/api/health', async (_request, reply) => {
    const started = performance.now();
    try {
      await deps.pool.query('SELECT 1');
      const latencyMs = Math.round(performance.now() - started);
      return HealthResponse.parse({ ok: true, db: { ok: true, latencyMs }, features: settings });
    } catch (error) {
      reply.code(503);
      return HealthResponse.parse({
        ok: false,
        db: { ok: false, error: error instanceof Error ? error.message : String(error) },
        features: settings,
      });
    }
  });
}
