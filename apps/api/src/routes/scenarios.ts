import { InternalScenarioResponse, ScenarioId, ScenarioListResponse } from '@ccc/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.ts';
import { requireInternalSecret } from '../internal.ts';
import { byDifficulty, latestScenario, latestScenarios, toSummary } from '../scenarios.ts';

const ScenarioParams = z.object({ id: ScenarioId });

export function registerScenarioRoutes(
  app: FastifyInstance,
  { config, db, catalog }: AppContext,
): void {
  app.get('/api/scenarios', async (request) => {
    const specs = await latestScenarios(db, request.log);
    return ScenarioListResponse.parse({ scenarios: specs.sort(byDifficulty).map(toSummary) });
  });

  // The agent's view: the whole scenario, private facts included, plus the
  // product for the judge. The prospect's prompt never sees the product.
  app.get(
    '/internal/scenarios/:id',
    { preHandler: requireInternalSecret(config) },
    async (request, reply) => {
      const { id } = ScenarioParams.parse(request.params);
      const scenario = await latestScenario(db, id);
      if (!scenario) return reply.code(404).send({ error: `Unknown scenario: ${id}` });
      return InternalScenarioResponse.parse({ scenario, product: catalog.product });
    },
  );
}
