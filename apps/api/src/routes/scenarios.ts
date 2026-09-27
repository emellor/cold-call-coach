import {
  CreateScenarioRequest,
  CreateScenarioResponse,
  InternalScenarioResponse,
  ScenarioId,
  ScenarioListResponse,
} from '@ccc/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.ts';
import { requireInternalSecret } from '../internal.ts';
import {
  NO_WRITER_MESSAGE,
  type ProspectWriter,
  ProspectWriterError,
} from '../prospects/writer.ts';
import {
  archiveCustomScenario,
  insertCustomScenario,
  latestScenario,
  latestScenarios,
  pickerOrder,
  toSummary,
} from '../scenarios.ts';

const ScenarioParams = z.object({ id: ScenarioId });

export function registerScenarioRoutes(
  app: FastifyInstance,
  { config, db, catalog }: AppContext,
  /** Writes "Add new" prospects; null without ANTHROPIC_API_KEY. */
  writer: ProspectWriter | null,
): void {
  app.get('/api/scenarios', async (request) => {
    const stored = await latestScenarios(db, request.log);
    return ScenarioListResponse.parse({
      scenarios: stored.sort(pickerOrder).map((s) => toSummary(s.spec, s.custom)),
    });
  });

  // "Add new": Claude writes her from the rep's description, and she joins the
  // picker. Her private facts stay server-side like everyone else's.
  app.post('/api/scenarios', async (request, reply) => {
    const { description } = CreateScenarioRequest.parse(request.body);
    if (!writer) return reply.code(503).send({ error: NO_WRITER_MESSAGE });
    let written;
    try {
      written = await writer(description);
    } catch (error) {
      if (!(error instanceof ProspectWriterError)) throw error;
      request.log.warn({ err: error }, 'writing a prospect failed');
      return reply.code(502).send({ error: error.message });
    }
    await insertCustomScenario(db, written.scenario, description);
    request.log.info(
      {
        scenarioId: written.scenario.id,
        difficulty: written.scenario.difficulty,
        voice: written.voice,
      },
      'prospect added',
    );
    return reply.code(201).send(
      CreateScenarioResponse.parse({
        scenario: toSummary(written.scenario, true),
        voice: written.voice,
      }),
    );
  });

  // Only a prospect added with "Add new" can be removed, and only from the
  // picker: her calls keep their history.
  app.delete('/api/scenarios/:id', async (request, reply) => {
    const { id } = ScenarioParams.parse(request.params);
    if (!(await archiveCustomScenario(db, id))) {
      return reply.code(404).send({ error: `No prospect you added has the id ${id}.` });
    }
    return reply.code(204).send();
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
