import {
  DemoClaimResponse,
  DemoDetail,
  DemoListResponse,
  type DemoResultRequest,
  INTERNAL_SECRET_HEADER,
} from '@ccc/contracts';
import { eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { loadConfig } from '../config.ts';
import { createDb } from '../db/client.ts';
import { demos } from '../db/schema.ts';
import { MAX_ATTEMPTS } from '../demos/store.ts';
import { testCatalog } from '../test/catalog.ts';
import { databaseAvailable, testDatabaseUrl } from '../test/db.ts';
import { NO_AGENT_SECRET_MESSAGE } from './demos.ts';

const hasDb = await databaseAvailable();
const SECRET = 'route-test-internal-secret';
const MP3 = Buffer.from('ID3 pretend mp3 bytes');

const result = (patch: Partial<DemoResultRequest> = {}): DemoResultRequest => ({
  scenarioVersion: 1,
  title: 'Earning thirty seconds',
  summary: 'A permission opener, then discovery.',
  lessons: ['Ask first.', 'Follow up on her words.'],
  outcome: 'meeting_booked',
  outcomeDetail: 'Tuesday at 10am',
  costUsd: 0.62,
  turns: [
    {
      idx: 0,
      speaker: 'prospect',
      text: 'Claire Hughes.',
      technique: null,
      note: null,
      interest: null,
      patience: null,
      audioMs: 900,
      audio: MP3.toString('base64'),
    },
    {
      idx: 1,
      speaker: 'rep',
      text: 'Hi Claire, it’s Sam from WattGuard. Have I caught you at a bad time?',
      technique: 'Permission opener',
      note: 'Lowers her guard before any pitch.',
      interest: 24,
      patience: 53,
      audioMs: null,
      audio: null,
    },
  ],
  ...patch,
});

describe.skipIf(!hasDb)('demo call routes (real Postgres)', () => {
  const { pool, db } = createDb(testDatabaseUrl);
  let app: FastifyInstance;
  let before: string[] = [];

  const internal = (url: string, payload?: object, secret: string | null = SECRET) => {
    const options: InjectOptions = {
      method: 'POST',
      url,
      headers: secret === null ? {} : { [INTERNAL_SECRET_HEADER]: secret },
    };
    if (payload !== undefined) options.payload = payload;
    return app.inject(options);
  };
  const claim = async () =>
    DemoClaimResponse.parse((await internal('/internal/demos/claim')).json()).job;
  const list = async () =>
    DemoListResponse.parse((await app.inject({ method: 'GET', url: '/api/demos' })).json()).demos;

  beforeAll(async () => {
    // Demos someone already had in this database are left as they are.
    before = (await db.select({ id: demos.id }).from(demos)).map((d) => d.id);
    if (before.length) {
      await db
        .update(demos)
        .set({ status: 'failed', error: 'set aside by the route tests' })
        .where(inArray(demos.status, ['queued', 'generating']));
    }
    app = await buildApp(
      {
        config: loadConfig({ DATABASE_URL: testDatabaseUrl, INTERNAL_API_SECRET: SECRET }),
        pool,
        db,
        catalog: testCatalog,
        prospectWriter: null,
      },
      { webDistDir: '/nonexistent' },
    );
  });

  afterAll(async () => {
    await app.close();
    await db.delete(demos).where(before.length ? notInArray(demos.id, before) : sql`true`);
    await pool.end();
  });

  it('queues a batch across the prospects in the picker, and refuses a second while it runs', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/demos/generate',
      payload: { count: 4 },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ queued: 4 });

    const queued = (await list()).filter((d) => !before.includes(d.id));
    expect(queued.map((d) => [d.position, d.status])).toEqual([
      [1, 'queued'],
      [2, 'queued'],
      [3, 'queued'],
      [4, 'queued'],
    ]);
    expect(queued[0]?.prospect).toEqual({
      name: 'Priya Shah',
      role: 'Operations Manager',
      company: 'Northgate Bakeries',
      difficulty: 'easy',
    });
    expect(new Set(queued.map((d) => d.angle)).size).toBe(4);

    const again = await app.inject({ method: 'POST', url: '/api/demos/generate', payload: {} });
    expect(again.statusCode).toBe(409);
    expect(again.json<{ error: string }>().error).toContain('4 demo calls are still being written');
  });

  it('hands the agent the oldest demo, stores what it writes, and plays it back line by line', async () => {
    const job = await claim();
    expect(job).toMatchObject({ scenarioId: 'easy-ops-manager' });

    const posted = await internal(`/internal/demos/${job!.id}/result`, result());
    expect(posted.statusCode).toBe(204);

    const detail = DemoDetail.parse(
      (await app.inject({ method: 'GET', url: `/api/demos/${job!.id}` })).json(),
    );
    expect(detail).toMatchObject({
      status: 'ready',
      title: 'Earning thirty seconds',
      outcome: 'meeting_booked',
      outcomeDetail: 'Tuesday at 10am',
      lessons: ['Ask first.', 'Follow up on her words.'],
      durationMs: 900,
      costUsd: 0.62,
    });
    expect(detail.turns.map((t) => [t.idx, t.speaker, t.technique, t.audioMs])).toEqual([
      [0, 'prospect', null, 900],
      [1, 'rep', 'Permission opener', null],
    ]);

    const audio = await app.inject({
      method: 'GET',
      url: `/api/demos/${job!.id}/turns/0/audio`,
    });
    expect(audio.statusCode).toBe(200);
    expect(audio.headers['content-type']).toBe('audio/mpeg');
    expect(audio.rawPayload.equals(MP3)).toBe(true);
    const silent = await app.inject({ method: 'GET', url: `/api/demos/${job!.id}/turns/1/audio` });
    expect(silent.statusCode).toBe(404);
  });

  it(`retries a failed demo, gives up after ${MAX_ATTEMPTS} tries, and starts again on request`, async () => {
    const first = await claim();
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const job = attempt === 1 ? first : await claim();
      expect(job?.id).toBe(first?.id);
      const failed = await internal(`/internal/demos/${job!.id}/failed`, { error: 'Cartesia 500' });
      expect(failed.json()).toEqual({ status: attempt < MAX_ATTEMPTS ? 'queued' : 'failed' });
    }
    const [row] = await db.select().from(demos).where(eq(demos.id, first!.id));
    expect(row).toMatchObject({ status: 'failed', error: 'Cartesia 500', attempts: MAX_ATTEMPTS });

    const retried = await app.inject({ method: 'POST', url: '/api/demos/retry' });
    expect(retried.json<{ queued: number }>().queued).toBeGreaterThanOrEqual(1);
    const [again] = await db.select().from(demos).where(eq(demos.id, first!.id));
    expect(again).toMatchObject({ status: 'queued', attempts: 0, error: null });
  });

  it('takes over a claim its agent abandoned', async () => {
    const job = await claim();
    await db
      .update(demos)
      .set({ claimedAt: sql`now() - interval '20 minutes'` })
      .where(eq(demos.id, job!.id));
    expect((await claim())?.id).toBe(job!.id);
  });

  it('keeps the agent routes to the agent, and says what generating needs', async () => {
    expect((await internal('/internal/demos/claim', undefined, null)).statusCode).toBe(401);
    expect((await internal('/internal/demos/claim', undefined, 'wrong')).statusCode).toBe(401);
    const missing = await internal(
      '/internal/demos/00000000-0000-4000-8000-000000000000/result',
      result(),
    );
    expect(missing.statusCode).toBe(404);

    const open = await buildApp(
      { config: loadConfig({ DATABASE_URL: testDatabaseUrl }), pool, db, catalog: testCatalog },
      { webDistDir: '/nonexistent' },
    );
    const res = await open.inject({ method: 'POST', url: '/api/demos/generate', payload: {} });
    expect(res.statusCode).toBe(503);
    expect(res.json<{ error: string }>().error).toBe(NO_AGENT_SECRET_MESSAGE);
    await open.close();
  });
});
