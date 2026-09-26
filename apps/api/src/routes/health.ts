import { HealthResponse } from '@ccc/contracts';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { type Config, liveKitConfig } from '../config.ts';
import { LIVEKIT_REJECTED, type LiveKitAuth, type LiveKitAuthCheck } from '../livekitCheck.ts';

/**
 * What this API's settings allow, for the page to warn about before a call.
 * `livekit` is LiveKit's own verdict on the key pair, when it has given one.
 */
export function features(
  config: Config,
  reviewsEnabled: boolean,
  livekit: LiveKitAuth = 'unknown',
): HealthResponse['features'] {
  const settings = liveKitConfig(config);
  return {
    calls:
      'problem' in settings
        ? { ok: false, reason: `Calls are off: ${settings.problem}` }
        : livekit === 'rejected'
          ? { ok: false, reason: LIVEKIT_REJECTED }
          : { ok: true },
    reviews: reviewsEnabled
      ? { ok: true }
      : { ok: false, reason: 'Reviews are off: set ANTHROPIC_API_KEY on the API.' },
  };
}

export function registerHealthRoutes(
  app: FastifyInstance,
  deps: {
    pool: pg.Pool;
    config: Config;
    reviewsEnabled: boolean;
    /** Null when LiveKit isn't configured (or in tests that don't want the network). */
    livekit: LiveKitAuthCheck | null;
  },
): void {
  app.get('/api/health', async (_request, reply) => {
    const settings = features(
      deps.config,
      deps.reviewsEnabled,
      deps.livekit ? await deps.livekit.auth() : 'unknown',
    );
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
