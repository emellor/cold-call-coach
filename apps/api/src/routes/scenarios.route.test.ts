import {
  INTERNAL_SECRET_HEADER,
  InternalScenarioResponse,
  ScenarioListResponse,
} from '@ccc/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { loadConfig } from '../config.ts';
import { createDb } from '../db/client.ts';
import { testCatalog } from '../test/catalog.ts';
import { databaseAvailable, testDatabaseUrl } from '../test/db.ts';

const hasDb = await databaseAvailable();
const SECRET = 'route-test-internal-secret';
const V1_IDS = ['easy-ops-manager', 'medium-finance-director', 'hard-facilities-manager'];

describe.skipIf(!hasDb)('scenario routes (real Postgres)', () => {
  const { pool, db } = createDb(testDatabaseUrl);
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(
      {
        config: loadConfig({ DATABASE_URL: testDatabaseUrl, INTERNAL_API_SECRET: SECRET }),
        pool,
        db,
        catalog: testCatalog,
      },
      { webDistDir: '/nonexistent' },
    );
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  describe('GET /api/scenarios', () => {
    it('lists the v1 scenarios easiest first', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/scenarios' });
      expect(res.statusCode).toBe(200);
      const { scenarios } = ScenarioListResponse.parse(res.json());
      // Other test files may add rows of their own while this runs.
      const v1 = scenarios.filter((s) => V1_IDS.includes(s.id));
      expect(v1.map((s) => s.id)).toEqual(V1_IDS);
      expect(v1[1]).toEqual({
        id: 'medium-finance-director',
        version: 1,
        title: 'Busy finance director',
        difficulty: 'medium',
        winCondition: 'Agrees to a 20-minute call at a specific day and time',
        prospect: {
          name: 'Claire Hughes',
          role: 'Finance Director',
          company: 'Harrow & Finch Logistics',
        },
      });
    });

    it('keeps the private facts and thresholds off the wire', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/scenarios' });
      for (const word of ['hidden', 'pains', 'patience', 'meetingAt', 'objections', 'voiceId']) {
        expect(res.body).not.toContain(word);
      }
    });
  });

  describe('GET /internal/scenarios/:id', () => {
    const get = (id: string, headers: Record<string, string> = {}) =>
      app.inject({ method: 'GET', url: `/internal/scenarios/${id}`, headers });

    it('returns the whole scenario and the product to the agent', async () => {
      const res = await get('hard-facilities-manager', { [INTERNAL_SECRET_HEADER]: SECRET });
      expect(res.statusCode).toBe(200);
      const body = InternalScenarioResponse.parse(res.json());
      expect(body.scenario.prospect.name).toBe('Denise Walsh');
      expect(body.scenario.prospect.hidden.pains).toHaveLength(2);
      expect(body.product).toEqual(testCatalog.product);
    });

    it('answers 401 without the secret or with the wrong one', async () => {
      expect((await get('easy-ops-manager')).statusCode).toBe(401);
      const wrong = await get('easy-ops-manager', { [INTERNAL_SECRET_HEADER]: 'nope' });
      expect(wrong.statusCode).toBe(401);
      expect(wrong.body).not.toContain('Priya');
    });

    it('answers 404 for an unknown scenario and 400 for a malformed id', async () => {
      const auth = { [INTERNAL_SECRET_HEADER]: SECRET };
      expect((await get('nobody-home', auth)).statusCode).toBe(404);
      expect((await get('Not_An_Id', auth)).statusCode).toBe(400);
    });

    it('answers 503 when the API has no secret configured', async () => {
      const open = await buildApp(
        { config: loadConfig({ DATABASE_URL: testDatabaseUrl }), pool, db, catalog: testCatalog },
        { webDistDir: '/nonexistent' },
      );
      const res = await open.inject({
        method: 'GET',
        url: '/internal/scenarios/easy-ops-manager',
        headers: { [INTERNAL_SECRET_HEADER]: '' },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json<{ error: string }>().error).toContain('INTERNAL_API_SECRET');
      await open.close();
    });
  });
});
