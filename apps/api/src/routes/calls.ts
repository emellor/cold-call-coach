import { CreateCallRequest, CreateCallResponse } from '@ccc/contracts';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.ts';
import { liveKitConfig } from '../config.ts';
import { LOCAL_USER_ID, calls } from '../db/schema.ts';
import { mintRepToken } from '../livekit.ts';
import { latestScenario } from '../scenarios.ts';

export function registerCallRoutes(app: FastifyInstance, { config, db }: AppDeps): void {
  app.post('/api/calls', async (request, reply) => {
    const { scenarioId, mode } = CreateCallRequest.parse(request.body);

    // The call records the version it was made with; the agent loads the latest.
    const scenario = await latestScenario(db, scenarioId);
    if (!scenario) return reply.code(404).send({ error: `Unknown scenario: ${scenarioId}` });
    const scenarioVersion = scenario.version;

    const livekit = liveKitConfig(config);
    if ('missing' in livekit) {
      return reply.code(503).send({
        error: `LiveKit is not configured on the server: set ${livekit.missing.join(', ')}.`,
      });
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
