import {
  CreateDemoRequest,
  CreateDemoResponse,
  DemoDetail,
  DemoListResponse,
  GenerateDemosRequest,
  GenerateDemosResponse,
  PracticeProspectResponse,
} from '@ccc/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.ts';
import type { DemoQueue } from '../demos/queue.ts';
import {
  demoDetail,
  demosInProgress,
  linkPracticeScenario,
  listDemos,
  practiceSource,
  queueBriefDemo,
  queueDemos,
  retryFailedDemos,
} from '../demos/store.ts';
import { NO_DEMO_WRITER_MESSAGE } from '../demos/writer.ts';
import {
  NO_WRITER_MESSAGE,
  type ProspectWriter,
  ProspectWriterError,
} from '../prospects/writer.ts';
import {
  insertCustomScenario,
  latestScenario,
  latestScenarios,
  pickerOrder,
  toSummary,
} from '../scenarios.ts';

const DemoParams = z.object({ id: z.uuid() });

export function registerDemoRoutes(
  app: FastifyInstance,
  { db }: AppContext,
  queue: DemoQueue,
  /** "Add new"'s writer, for "Practise this call"; null without ANTHROPIC_API_KEY. */
  prospectWriter: ProspectWriter | null,
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

  // "Practise this call": the prospect from a demo's brief joins the picker, so
  // the rep can practise the call they have just read. One "Add new" request,
  // kept consistent with the demo; a second press returns her without writing
  // her again.
  app.post('/api/demos/:id/practice', async (request, reply) => {
    const { id } = DemoParams.parse(request.params);
    if (!prospectWriter) return reply.code(503).send({ error: NO_WRITER_MESSAGE });
    const demo = await practiceSource(db, id);
    if (!demo) return reply.code(404).send({ error: 'No such demo call.' });
    if (demo.brief === null || demo.prospect === null) {
      return reply.code(409).send({
        error:
          "Only a demo written from your brief can be practised: the others' prospects are in the picker already.",
      });
    }
    if (demo.status !== 'ready') {
      return reply.code(409).send({ error: 'This demo call has not been written yet.' });
    }
    const existing = demo.practiceScenarioId
      ? await latestScenario(db, demo.practiceScenarioId)
      : undefined;
    if (existing) {
      return reply.send(PracticeProspectResponse.parse({ scenario: toSummary(existing, true) }));
    }
    let written;
    try {
      written = await prospectWriter(demo.brief, { prospect: demo.prospect, lines: demo.lines });
    } catch (error) {
      if (!(error instanceof ProspectWriterError)) throw error;
      request.log.warn({ err: error, demoId: id }, 'writing the practice prospect failed');
      return reply.code(502).send({ error: error.message });
    }
    await insertCustomScenario(db, written.scenario, demo.brief);
    await linkPracticeScenario(db, id, written.scenario.id);
    request.log.info(
      { demoId: id, scenarioId: written.scenario.id, voice: written.voice },
      'practice prospect added from a demo',
    );
    return reply
      .code(201)
      .send(PracticeProspectResponse.parse({ scenario: toSummary(written.scenario, true) }));
  });

  app.get('/api/demos/:id', async (request, reply) => {
    const { id } = DemoParams.parse(request.params);
    const demo = await demoDetail(db, id);
    if (!demo) return reply.code(404).send({ error: 'No such demo call.' });
    return DemoDetail.parse(demo);
  });
}
