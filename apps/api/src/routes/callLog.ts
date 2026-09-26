import { CallLog, CallLogResponse, type ReviewStatus } from '@ccc/contracts';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.ts';
import { saveCallLog } from '../calls/store.ts';
import { reviews } from '../db/schema.ts';
import { requireInternalSecret } from '../internal.ts';
import type { ReviewQueue } from '../review/queue.ts';

const CallParams = z.object({ id: z.uuid() });

/** Statuses that mean the review is done or under way: a re-posted log leaves them be. */
const SETTLED: readonly ReviewStatus[] = ['pending', 'running', 'ready', 'skipped'];

export function registerCallLogRoutes(
  app: FastifyInstance,
  { config, db }: AppDeps,
  queue: ReviewQueue,
): void {
  // The agent posts the whole log when the call ends, for any reason. It is
  // replaced wholesale, so a retried post changes nothing; the review is
  // queued only if the call has none yet (or the last one failed).
  app.post(
    '/internal/calls/:id/log',
    { preHandler: requireInternalSecret(config), bodyLimit: 5 * 1024 * 1024 },
    async (request, reply) => {
      const { id } = CallParams.parse(request.params);
      const log = CallLog.parse(request.body);
      if (!(await saveCallLog(db, id, log))) {
        return reply.code(404).send({ error: `Unknown call: ${id}` });
      }
      const [existing] = await db
        .select({ status: reviews.status })
        .from(reviews)
        .where(eq(reviews.callId, id));
      const review =
        existing && SETTLED.includes(existing.status) ? existing.status : await queue.enqueue(id);
      request.log.info(
        { callId: id, outcome: log.outcome, turns: log.turns.length, review },
        'call log stored',
      );
      return CallLogResponse.parse({ ok: true, review });
    },
  );
}
