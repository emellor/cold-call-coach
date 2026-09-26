import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/**
 * Serves the built SPA (apps/web/dist) when it exists, which is what
 * `pnpm build && pnpm start` produces. In development Vite serves the SPA on
 * :5173 and proxies /api here instead.
 */
export async function registerWeb(app: FastifyInstance, distDir: string): Promise<void> {
  if (!existsSync(join(distDir, 'index.html'))) {
    app.log.info({ distDir }, 'no web build found; the API will not serve the SPA');
    return;
  }

  await app.register(fastifyStatic, {
    root: distDir,
    setHeaders(reply, path) {
      // Vite fingerprints everything under assets/, so those never change.
      void reply.header(
        'cache-control',
        path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    },
  });

  // Client-side routes (/calls/…) resolve to index.html; API misses stay JSON.
  app.setNotFoundHandler((request, reply) => {
    const isApi = request.url.startsWith('/api/') || request.url.startsWith('/internal/');
    if (request.method === 'GET' && !isApi) {
      return reply.type('text/html').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not found' });
  });
}
