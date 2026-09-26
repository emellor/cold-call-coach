import { HealthResponse } from '@ccc/contracts';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

export function registerHealthRoutes(app: FastifyInstance, pool: pg.Pool): void {
  app.get('/api/health', async (_request, reply) => {
    const started = performance.now();
    try {
      await pool.query('SELECT 1');
      const latencyMs = Math.round(performance.now() - started);
      return HealthResponse.parse({ ok: true, db: { ok: true, latencyMs } });
    } catch (error) {
      reply.code(503);
      return HealthResponse.parse({
        ok: false,
        db: { ok: false, error: error instanceof Error ? error.message : String(error) },
      });
    }
  });
}
