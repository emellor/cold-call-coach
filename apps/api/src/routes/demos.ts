import {
  CreateDemoRequest,
  CreateDemoResponse,
  DemoDetail,
  DemoListResponse,
  GenerateDemosRequest,
  GenerateDemosResponse,
} from '@ccc/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.ts';
import type { DemoQueue } from '../demos/queue.ts';
import {
  demoDetail,
  demosInProgress,
  listDemos,
  queueBriefDemo,
  queueDemos,
  retryFailedDemos,
} from '../demos/store.ts';
import { NO_DEMO_WRITER_MESSAGE } from '../demos/writer.ts';
import { latestScenarios, pickerOrder } from '../scenarios.ts';

const DemoParams = z.object({ id: z.uuid() });

export function registerDemoRoutes(
  app: FastifyInstance,
  { db }: AppContext,
  queue: DemoQueue,
): void {
  app.get('/api/demos', async () => DemoListResponse.parse({ demos: await listDemos(db) }));

  // One press queues a batch across every prospect in the picker; the queue
  // writes them in the background, a few at a time, one Claude call each.
  app.post('/api/demos/generate', async (request, reply) => {
    const { count } = GenerateDemosRequest.parse(request.body ?? {});
    if (!queue.enabled) return reply.code(503).send({ error: NO_DEMO_WRITER_MESSAGE });
    const waiting = await demosInProgress(db);
    if (waiting) {
      return reply.code(409).send({
        error: `${waiting} demo call${waiting === 1 ? ' is' : 's are'} still being written: wait for ${waiting === 1 ? 'it' : 'them'} to finish.`,
      });
    }
    const prospects = (await latestScenarios(db, request.log)).sort(pickerOrder);
    const queued = await queueDemos(
      db,
      prospects.map((p) => p.spec.id),
      count,
    );
    queue.kick();
    request.log.info({ queued }, 'demo calls queued');
    return reply.code(202).send(GenerateDemosResponse.parse({ queued }));
  });

  // One demo from the rep's own brief. It is written ahead of any batch, and the
  // web waits for it on the demo's page.
  app.post('/api/demos', async (request, reply) => {
    const parsed = CreateDemoRequest.safeParse(request.body ?? {});
    if (!parsed.success) {
      const [issue] = parsed.error.issues;
      return reply.code(400).send({ error: issue?.message ?? 'Invalid request' });
    }
    if (!queue.enabled) return reply.code(503).send({ error: NO_DEMO_WRITER_MESSAGE });
    const id = await queueBriefDemo(db, parsed.data.brief);
    queue.kick();
    request.log.info({ demoId: id }, 'demo call from a brief queued');
    return reply.code(202).send(CreateDemoResponse.parse({ id }));
  });

  app.post('/api/demos/retry', async (_request, reply) => {
    if (!queue.enabled) return reply.code(503).send({ error: NO_DEMO_WRITER_MESSAGE });
    const queued = await retryFailedDemos(db);
    queue.kick();
    return reply.code(202).send(GenerateDemosResponse.parse({ queued }));
  });

  app.get('/api/demos/:id', async (request, reply) => {
    const { id } = DemoParams.parse(request.params);
    const demo = await demoDetail(db, id);
    if (!demo) return reply.code(404).send({ error: 'No such demo call.' });
    return DemoDetail.parse(demo);
  });
}
