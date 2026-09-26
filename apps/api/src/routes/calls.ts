import { CreateCallRequest, CreateCallResponse } from '@ccc/contracts';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.ts';
import { liveKitConfig } from '../config.ts';
import { LOCAL_USER_ID, calls } from '../db/schema.ts';
import { mintRepToken } from '../livekit.ts';

/**
 * M1 knows one scenario, hard-coded in the agent. M3 replaces this with the
 * scenarios table.
 */
const KNOWN_SCENARIOS: Record<string, number> = { 'medium-finance-director': 1 };

export function registerCallRoutes(app: FastifyInstance, { config, db }: AppDeps): void {
  app.post('/api/calls', async (request, reply) => {
    const { scenarioId, mode } = CreateCallRequest.parse(request.body);

    const scenarioVersion = KNOWN_SCENARIOS[scenarioId];
    if (scenarioVersion === undefined) {
      return reply.code(404).send({ error: `Unknown scenario: ${scenarioId}` });
    }

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
