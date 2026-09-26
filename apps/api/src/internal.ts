import { createHash, timingSafeEqual } from 'node:crypto';
import { INTERNAL_SECRET_HEADER } from '@ccc/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.ts';

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * preHandler for the agent-only /internal routes: the request must carry
 * INTERNAL_API_SECRET in `x-internal-secret`. Digests are compared so the
 * check takes the same time whatever the header holds.
 */
export function requireInternalSecret(config: Config) {
  const expected = config.INTERNAL_API_SECRET ? digest(config.INTERNAL_API_SECRET) : undefined;
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!expected) {
      return reply
        .code(503)
        .send({ error: 'INTERNAL_API_SECRET is not set on the API, so /internal routes are off.' });
    }
    const given = request.headers[INTERNAL_SECRET_HEADER];
    if (typeof given !== 'string' || !timingSafeEqual(digest(given), expected)) {
      return reply.code(401).send({ error: `Missing or wrong ${INTERNAL_SECRET_HEADER} header.` });
    }
  };
}
