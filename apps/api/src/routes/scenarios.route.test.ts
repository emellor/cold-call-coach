import { randomUUID } from 'node:crypto';
import {
  CharacterResponse,
  CreateScenarioResponse,
  INTERNAL_SECRET_HEADER,
  InternalScenarioResponse,
  ScenarioListResponse,
} from '@ccc/contracts';
import { eq, like } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { loadConfig } from '../config.ts';
import { createDb } from '../db/client.ts';
import { scenarios } from '../db/schema.ts';
import {
  NO_WRITER_MESSAGE,
  type ProspectWriter,
  ProspectWriterError,
} from '../prospects/writer.ts';
import { testCatalog } from '../test/catalog.ts';
import { databaseAvailable, testDatabaseUrl } from '../test/db.ts';
import { stubWriter } from '../test/prospects.ts';

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
  // Prospects added here get ids with this prefix, so they are easy to clean up.
  const prefix = `zz-added-${randomUUID().slice(0, 8)}`;
  const withWriter = (writer: ProspectWriter | null) =>
    buildApp(
      {
        config: loadConfig({ DATABASE_URL: testDatabaseUrl, INTERNAL_API_SECRET: SECRET }),
        pool,
        db,
        catalog: testCatalog,
        prospectWriter: writer,
      },
      { webDistDir: '/nonexistent' },
    );

  afterAll(async () => {
    await app.close();
    await db.delete(scenarios).where(like(scenarios.id, `${prefix}-%`));
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
        custom: false,
      });
    });

    it('keeps the private facts and thresholds off the wire', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/scenarios' });
      for (const word of ['hidden', 'pains', 'patience', 'meetingAt', 'objections', 'voiceId']) {
        expect(res.body).not.toContain(word);
      }
    });
  });

  describe('POST /api/scenarios ("Add new") and DELETE /api/scenarios/:id', () => {
    const add = (target: FastifyInstance, description: string) =>
      target.inject({ method: 'POST', url: '/api/scenarios', payload: { description } });

    it('writes her from the description, stores her, and lists her after the shipped ones', async () => {
      const id = `${prefix}-rachel`;
      const { writer, descriptions } = stubWriter(id);
      const added = await withWriter(writer);
      const res = await add(added, '  A mid-sized energy broker, very tough to sell to.  ');
      expect(res.statusCode).toBe(201);
      expect(CreateScenarioResponse.parse(res.json())).toEqual({
        scenario: {
          id,
          version: 1,
          title: 'Energy broker with an in-house dev team',
          difficulty: 'hard',
          winCondition: 'Agrees to a 20-minute call at a specific day and time',
          prospect: {
            name: 'Rachel Byrne',
            role: 'Operations Director',
            company: 'Voltline Energy Partners',
          },
          custom: true,
        },
        voice: 'default',
      });
      expect(descriptions).toEqual(['A mid-sized energy broker, very tough to sell to.']);
      // Her private facts stay server-side, as everyone else's do.
      expect(res.body).not.toContain('home-grown portal');

      const [row] = await db.select().from(scenarios).where(eq(scenarios.id, id));
      expect(row).toMatchObject({
        source: 'custom',
        description: 'A mid-sized energy broker, very tough to sell to.',
      });

      const listed = ScenarioListResponse.parse(
        (await added.inject({ method: 'GET', url: '/api/scenarios' })).json(),
      ).scenarios;
      const at = listed.findIndex((s) => s.id === id);
      expect(at).toBeGreaterThan(listed.findIndex((s) => s.id === 'hard-facilities-manager'));
      expect(listed[at]?.custom).toBe(true);

      // The agent can load her for a call.
      const internal = await added.inject({
        method: 'GET',
        url: `/internal/scenarios/${id}`,
        headers: { [INTERNAL_SECRET_HEADER]: SECRET },
      });
      expect(InternalScenarioResponse.parse(internal.json()).scenario.prospect.name).toBe(
        'Rachel Byrne',
      );
      await added.close();
    });

    it('removes a prospect you added, and only one you added', async () => {
      const id = `${prefix}-gone`;
      const added = await withWriter(stubWriter(id).writer);
      expect((await add(added, 'A tough broker who hates cold calls.')).statusCode).toBe(201);

      const remove = (target: string) =>
        added.inject({ method: 'DELETE', url: `/api/scenarios/${target}` });
      expect((await remove(id)).statusCode).toBe(204);
      expect((await remove(id)).statusCode).toBe(404);
      expect((await remove('hard-facilities-manager')).statusCode).toBe(404);
      const listed = ScenarioListResponse.parse(
        (await added.inject({ method: 'GET', url: '/api/scenarios' })).json(),
      ).scenarios;
      expect(listed.some((s) => s.id === id)).toBe(false);
      expect(listed.some((s) => s.id === 'hard-facilities-manager')).toBe(true);
      await added.close();
    });

    it('refuses a description too short to write from', async () => {
      const added = await withWriter(stubWriter(`${prefix}-short`).writer);
      const res = await add(added, 'tough');
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('Describe her in a sentence or two.');
      await added.close();
    });

    it('says why when she could not be written', async () => {
      const off = await withWriter(null);
      const res = await add(off, 'A friendly office manager with time to talk.');
      expect(res.statusCode).toBe(503);
      expect(res.json<{ error: string }>().error).toBe(NO_WRITER_MESSAGE);
      await off.close();

      const failing = await withWriter(() =>
        Promise.reject(new ProspectWriterError('Claude is overloaded. Try again shortly.')),
      );
      const failed = await add(failing, 'A friendly office manager with time to talk.');
      expect(failed.statusCode).toBe(502);
      expect(failed.json<{ error: string }>().error).toBe(
        'Claude is overloaded. Try again shortly.',
      );
      await failing.close();
    });
  });

  describe('GET /api/scenarios/:id/character (a reverse call: the rep plays her)', () => {
    it('gives the rep the whole of her, private facts and objections included', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/scenarios/medium-finance-director/character',
      });
      expect(res.statusCode).toBe(200);
      const { prospect } = CharacterResponse.parse(res.json());
      expect(prospect).toMatchObject({
        name: 'Claire Hughes',
        openingLine: expect.any(String) as unknown,
      });
      expect(prospect.hidden.pains.length).toBeGreaterThan(0);
      expect(prospect.objections.length).toBeGreaterThan(0);
      // Her thresholds and voice stay on the server even so.
      for (const word of ['patience', 'meetingAt', 'voiceId']) {
        expect(res.body).not.toContain(word);
      }
    });

    it('answers 404 for an unknown prospect and 400 for a malformed id', async () => {
      const get = (id: string) =>
        app.inject({ method: 'GET', url: `/api/scenarios/${id}/character` });
      expect((await get('nobody-home')).statusCode).toBe(404);
      expect((await get('Not_Kebab')).statusCode).toBe(400);
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
      // Sam plays to its 10/10 marks in a reverse call.
      expect(body.rubric?.id).toBe(body.scenario.rubricId);
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
