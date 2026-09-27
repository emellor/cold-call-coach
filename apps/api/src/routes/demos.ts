import {
  DemoClaimResponse,
  DemoDetail,
  DemoFailureRequest,
  DemoListResponse,
  DemoResultRequest,
  GenerateDemosRequest,
  GenerateDemosResponse,
} from '@ccc/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.ts';
import {
  claimDemo,
  demoAudio,
  demoDetail,
  demosInProgress,
  failDemo,
  listDemos,
  queueDemos,
  retryFailedDemos,
  saveDemo,
} from '../demos/store.ts';
import { requireInternalSecret } from '../internal.ts';
import { latestScenarios, pickerOrder } from '../scenarios.ts';

const DemoParams = z.object({ id: z.uuid() });
const AudioParams = DemoParams.extend({ idx: z.coerce.number().int().nonnegative() });

export const NO_AGENT_SECRET_MESSAGE =
  'The voice agent writes the demos and collects them with INTERNAL_API_SECRET: set it on the API and the agent.';

/** A finished demo, audio and all: twenty-odd lines of MP3 as base64. */
const RESULT_BODY_LIMIT = 40 * 1024 * 1024;

export function registerDemoRoutes(app: FastifyInstance, { config, db }: AppContext): void {
  app.get('/api/demos', async () => DemoListResponse.parse({ demos: await listDemos(db) }));

  // One press queues a batch across every prospect in the picker. The agent
  // writes them in the background, one at a time.
  app.post('/api/demos/generate', async (request, reply) => {
    const { count } = GenerateDemosRequest.parse(request.body ?? {});
    if (!config.INTERNAL_API_SECRET)
      return reply.code(503).send({ error: NO_AGENT_SECRET_MESSAGE });
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
    request.log.info({ queued }, 'demo calls queued');
    return reply.code(202).send(GenerateDemosResponse.parse({ queued }));
  });

  app.post('/api/demos/retry', async (_request, reply) => {
    const queued = await retryFailedDemos(db);
    return reply.code(202).send(GenerateDemosResponse.parse({ queued }));
  });

  app.get('/api/demos/:id', async (request, reply) => {
    const { id } = DemoParams.parse(request.params);
    const demo = await demoDetail(db, id);
    if (!demo) return reply.code(404).send({ error: 'No such demo call.' });
    return DemoDetail.parse(demo);
  });

  // A line's audio never changes once written, so the browser can keep it.
  app.get('/api/demos/:id/turns/:idx/audio', async (request, reply) => {
    const { id, idx } = AudioParams.parse(request.params);
    const audio = await demoAudio(db, id, idx);
    if (!audio) return reply.code(404).send({ error: 'No audio for that line.' });
    return reply
      .header('content-type', 'audio/mpeg')
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(audio);
  });

  // The agent's side: claim the next demo, post it back written, or say it failed.
  const internal = { preHandler: requireInternalSecret(config) };

  // Asked every 20 s while the agent idles: its request lines would bury the log.
  app.post('/internal/demos/claim', { ...internal, logLevel: 'warn' }, async () =>
    DemoClaimResponse.parse({ job: await claimDemo(db) }),
  );

  app.post(
    '/internal/demos/:id/result',
    { ...internal, bodyLimit: RESULT_BODY_LIMIT },
    async (request, reply) => {
      const { id } = DemoParams.parse(request.params);
      const result = DemoResultRequest.parse(request.body);
      if (!(await saveDemo(db, id, result))) {
        return reply.code(404).send({ error: 'No such demo call.' });
      }
      request.log.info(
        { demoId: id, outcome: result.outcome, turns: result.turns.length },
        'demo call ready',
      );
      return reply.code(204).send();
    },
  );

  app.post('/internal/demos/:id/failed', internal, async (request, reply) => {
    const { id } = DemoParams.parse(request.params);
    const { error } = DemoFailureRequest.parse(request.body);
    const status = await failDemo(db, id, error);
    if (!status) return reply.code(404).send({ error: 'No such demo call.' });
    request.log.warn({ demoId: id, error, status }, 'demo call failed');
    return { status };
  });
}
