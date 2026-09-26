import {
  CallDetail,
  CallListResponse,
  CreateCallRequest,
  CreateCallResponse,
  ReviewRerunResponse,
} from '@ccc/contracts';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.ts';
import { getCallDetail, listCalls } from '../calls/store.ts';
import { liveKitConfig } from '../config.ts';
import { LOCAL_USER_ID, calls } from '../db/schema.ts';
import { mintRepToken } from '../livekit.ts';
import type { ReviewQueue } from '../review/queue.ts';
import { latestScenario } from '../scenarios.ts';

const CallParams = z.object({ id: z.uuid() });

export function registerCallRoutes(
  app: FastifyInstance,
  { config, db, prices }: AppContext,
  queue: ReviewQueue,
): void {
  const { warnAboveUsd } = prices;
  app.get('/api/calls', async () =>
    CallListResponse.parse({ calls: await listCalls(db, warnAboveUsd) }),
  );

  app.get('/api/calls/:id', async (request, reply) => {
    const { id } = CallParams.parse(request.params);
    const detail = await getCallDetail(db, id, warnAboveUsd);
    if (!detail) return reply.code(404).send({ error: `Unknown call: ${id}` });
    return CallDetail.parse(detail);
  });

  app.post('/api/calls/:id/review/rerun', async (request, reply) => {
    const { id } = CallParams.parse(request.params);
    const [call] = await db
      .select({ status: calls.status })
      .from(calls)
      .where(and(eq(calls.id, id), eq(calls.userId, LOCAL_USER_ID)));
    if (!call) return reply.code(404).send({ error: `Unknown call: ${id}` });
    if (call.status !== 'ended') {
      return reply.code(409).send({ error: "This call's log hasn't arrived yet." });
    }
    const status = await queue.enqueue(id);
    return reply.code(202).send(ReviewRerunResponse.parse({ status }));
  });

  app.post('/api/calls', async (request, reply) => {
    const { scenarioId, mode } = CreateCallRequest.parse(request.body);

    // The call records the version it was made with; the agent loads the latest.
    const scenario = await latestScenario(db, scenarioId);
    if (!scenario) return reply.code(404).send({ error: `Unknown scenario: ${scenarioId}` });
    const scenarioVersion = scenario.version;

    const livekit = liveKitConfig(config);
    if ('problem' in livekit) {
      return reply.code(503).send({ error: `Calls are off: ${livekit.problem}` });
    }

    const [call] = await db
      .insert(calls)
      .values({ userId: LOCAL_USER_ID, scenarioId, scenarioVersion, mode, status: 'ringing' })
      .returning({ id: calls.id });
    if (!call) throw new Error('insert into calls returned no row');

    const token = await mintRepToken(livekit, { callId: call.id, scenarioId, mode });
    return reply
      .code(201)
      .send(CreateCallResponse.parse({ callId: call.id, url: livekit.url, token }));
  });
}
