import { randomUUID } from 'node:crypto';
import {
  CreateDemoResponse,
  DemoDetail,
  DemoListResponse,
  PracticeProspectResponse,
  ScenarioListResponse,
} from '@ccc/contracts';
import { DEMO_ANGLES, type ModelCall, demoPlan } from '@ccc/core';
import { eq, inArray, like, notInArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { loadConfig } from '../config.ts';
import { createDb } from '../db/client.ts';
import { demoTurns, demos, scenarios } from '../db/schema.ts';
import { MAX_ATTEMPTS, claimDemo, failDemo, queueBriefDemo, queueDemos } from '../demos/store.ts';
import { NO_DEMO_WRITER_MESSAGE } from '../demos/writer.ts';
import { NO_WRITER_MESSAGE, type ProspectWriter } from '../prospects/writer.ts';
import { testCatalog } from '../test/catalog.ts';
import { databaseAvailable, testDatabaseUrl } from '../test/db.ts';
import { briefProspect, stubDemoWriter, writtenDemo } from '../test/demos.ts';

const hasDb = await databaseAvailable();
const BROKEN = DEMO_ANGLES[2]!;
const BRIEF =
  'Tom Reid, head of estates at Carewell, 14 care homes in Yorkshire. Gas bills doubled last winter. Objective: a site visit.';

describe.skipIf(!hasDb)('demo call routes (real Postgres)', () => {
  const { pool, db } = createDb(testDatabaseUrl);
  const stub = stubDemoWriter({
    failOn: (angle) => (angle === BROKEN && failing ? 'Claude answered 400: no credit' : null),
  });
  let failing = true;
  let app: FastifyInstance;
  let before: string[] = [];

  // "Practise this call": what the prospect writer was asked, and a prospect from a shipped one.
  const practised: Array<{ description: string; modelCall?: ModelCall }> = [];
  const prospectWriter: ProspectWriter = (description, modelCall) => {
    practised.push({ description, modelCall });
    const base = testCatalog.scenarios.find((s) => s.id === 'hard-facilities-manager')!;
    return Promise.resolve({
      scenario: {
        ...base,
        id: `demo-route-practice-${practised.length}`,
        prospect: { ...base.prospect, name: 'Tamsin Reid' },
      },
      voice: 'default',
    });
  };

  const build = (demoWriter: typeof stub.writer | null) =>
    buildApp(
      {
        config: loadConfig({ DATABASE_URL: testDatabaseUrl }),
        pool,
        db,
        catalog: testCatalog,
        prospectWriter: demoWriter ? prospectWriter : null,
        demoWriter,
      },
      { webDistDir: '/nonexistent' },
    );
  const list = async (target = app) =>
    DemoListResponse.parse(
      (await target.inject({ method: 'GET', url: '/api/demos' })).json(),
    ).demos.filter((d) => !before.includes(d.id));
  const detail = async (id: string) =>
    DemoDetail.parse((await app.inject({ method: 'GET', url: `/api/demos/${id}` })).json());

  beforeAll(async () => {
    // Demos someone already had in this database are left as they are.
    before = (await db.select({ id: demos.id }).from(demos)).map((d) => d.id);
    if (before.length) {
      await db
        .update(demos)
        .set({ status: 'failed', error: 'set aside by the route tests' })
        .where(inArray(demos.status, ['queued', 'generating']));
    }
    app = await build(stub.writer);
  });

  afterAll(async () => {
    await app.close();
    await db.delete(demos).where(before.length ? notInArray(demos.id, before) : sql`true`);
    await db.delete(scenarios).where(like(scenarios.id, 'demo-route-practice-%'));
    await pool.end();
  });

  it('writes a batch across the prospects, one request each, and refuses a second while it runs', async () => {
    // The picker as the batch is planned from it: the scenarios route tests add
    // prospects to this database while these run.
    const picker = ScenarioListResponse.parse(
      (await app.inject({ method: 'GET', url: '/api/scenarios' })).json(),
    ).scenarios.map((s) => s.id);
    stub.holdAll();
    const res = await app.inject({
      method: 'POST',
      url: '/api/demos/generate',
      payload: { count: 4 },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ queued: 4 });

    const waiting = await list();
    expect(waiting.map((d) => d.position)).toEqual([1, 2, 3, 4]);
    expect(waiting.every((d) => d.status === 'queued' || d.status === 'generating')).toBe(true);
    expect(waiting[0]?.prospect).toEqual({
      name: 'Priya Shah',
      role: 'Operations Manager',
      company: 'Northgate Bakeries',
      difficulty: 'easy',
      gender: 'female',
      locale: 'en-GB',
    });
    expect(waiting[0]).toMatchObject({ brief: null, angle: DEMO_ANGLES[0] });
    const again = await app.inject({ method: 'POST', url: '/api/demos/generate', payload: {} });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({
      error: '4 demo calls are still being written: wait for them to finish.',
    });

    stub.release();
    await app.demoQueue.idle();

    // Each demo was one call to the writer, with its own approach, the picker's prospects in turn.
    expect(stub.asked).toHaveLength(4);
    expect(stub.asked.map((a) => a.angle).sort()).toEqual(DEMO_ANGLES.slice(0, 4).toSorted());
    expect(stub.asked.map((a) => a.scenarioId).sort()).toEqual(
      demoPlan(4, picker)
        .map((p) => p.scenarioId)
        .sort(),
    );

    const written = await list();
    const [ready, , broken] = written;
    expect(written.map((d) => d.status)).toEqual(['ready', 'ready', 'failed', 'ready']);
    expect(ready).toMatchObject({ title: 'Earning thirty seconds', outcome: 'meeting_booked' });
    expect(broken).toMatchObject({ angle: BROKEN, error: 'Claude answered 400: no credit' });

    const demo = await detail(ready!.id);
    expect(demo).toMatchObject({
      summary: writtenDemo.summary,
      lessons: writtenDemo.lessons,
      outcomeDetail: writtenDemo.meeting,
      costUsd: 0.08,
    });
    expect(demo.turns).toEqual(writtenDemo.lines.map((line, idx) => ({ idx, ...line })));
  });

  it('never retries a failure by itself, and writes it again when the rep asks', async () => {
    const [broken] = (await list()).filter((d) => d.status === 'failed');
    expect(stub.asked.filter((a) => a.angle === BROKEN)).toHaveLength(1);

    failing = false;
    const res = await app.inject({ method: 'POST', url: '/api/demos/retry' });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ queued: 1 });
    await app.demoQueue.idle();

    const demo = await detail(broken!.id);
    expect(demo).toMatchObject({ status: 'ready', error: null });
    expect(demo.turns).toHaveLength(writtenDemo.lines.length);
    expect(stub.asked.filter((a) => a.angle === BROKEN)).toHaveLength(2);
  });

  it('picks up after a restart: once more, then gives up', async () => {
    const batchId = randomUUID();
    const [once, twice, gone] = await db
      .insert(demos)
      .values([
        {
          batchId,
          position: 1,
          scenarioId: 'hard-facilities-manager',
          angle: DEMO_ANGLES[5]!,
          status: 'generating',
          attempts: 1,
        },
        {
          batchId,
          position: 2,
          scenarioId: 'hard-facilities-manager',
          angle: DEMO_ANGLES[6]!,
          status: 'generating',
          attempts: MAX_ATTEMPTS,
        },
        {
          batchId,
          position: 3,
          scenarioId: 'someone-since-removed',
          angle: DEMO_ANGLES[7]!,
          status: 'queued',
        },
      ])
      .returning({ id: demos.id });

    expect(await app.demoQueue.resumeUnfinished()).toBe(1);
    await app.demoQueue.idle();

    expect(await detail(once!.id)).toMatchObject({ status: 'ready' });
    expect(await detail(twice!.id)).toMatchObject({
      status: 'failed',
      error: 'The API restarted while writing this demo. Retry it.',
    });
    expect(await detail(gone!.id)).toMatchObject({
      status: 'failed',
      error: 'This prospect has been removed, so the call was not written.',
    });
    const turns = await db.select().from(demoTurns).where(eq(demoTurns.demoId, twice!.id));
    expect(turns).toEqual([]);
  });

  it("writes one demo from the rep's brief, keeping who Claude made the prospect", async () => {
    const short = await app.inject({
      method: 'POST',
      url: '/api/demos',
      payload: { brief: 'Too short' },
    });
    expect(short.statusCode).toBe(400);
    expect(short.json()).toEqual({
      error: 'Say a little more: who you are calling, their business and what you want.',
    });

    const res = await app.inject({ method: 'POST', url: '/api/demos', payload: { brief: BRIEF } });
    expect(res.statusCode).toBe(202);
    const { id } = CreateDemoResponse.parse(res.json());
    await app.demoQueue.idle();

    expect(stub.briefs).toEqual([BRIEF]);
    const demo = await detail(id);
    expect(demo).toMatchObject({
      status: 'ready',
      position: 1,
      brief: BRIEF,
      angle: null,
      prospect: briefProspect,
      outcome: 'objective_met',
      outcomeDetail: writtenDemo.meeting,
    });
    expect(demo.turns).toHaveLength(writtenDemo.lines.length);
    expect((await list()).find((d) => d.id === id)).toMatchObject({ prospect: briefProspect });
  });

  it('adds the prospect from a brief demo to the picker once, consistent with the demo', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/demos', payload: { brief: BRIEF } });
    const { id } = CreateDemoResponse.parse(res.json());
    await app.demoQueue.idle();
    expect((await detail(id)).practiceProspect).toBeNull();

    const first = await app.inject({ method: 'POST', url: `/api/demos/${id}/practice` });
    expect(first.statusCode).toBe(201);
    const { scenario } = PracticeProspectResponse.parse(first.json());
    expect(scenario).toMatchObject({ custom: true, prospect: { name: 'Tamsin Reid' } });
    // Written from the brief, as the demo's prospect, saying what they said in it.
    expect(practised).toEqual([
      {
        description: BRIEF,
        modelCall: {
          prospect: briefProspect,
          lines: writtenDemo.lines.filter((l) => l.speaker === 'prospect').map((l) => l.text),
        },
      },
    ]);
    const picker = ScenarioListResponse.parse(
      (await app.inject({ method: 'GET', url: '/api/scenarios' })).json(),
    ).scenarios;
    expect(picker.map((s) => s.id)).toContain(scenario.id);
    expect((await detail(id)).practiceProspect).toEqual({ id: scenario.id, name: 'Tamsin Reid' });

    // A second press finds her rather than paying to write her again.
    const again = await app.inject({ method: 'POST', url: `/api/demos/${id}/practice` });
    expect(again.statusCode).toBe(200);
    expect(PracticeProspectResponse.parse(again.json()).scenario.id).toBe(scenario.id);
    expect(practised).toHaveLength(1);

    // A batch demo's prospect is in the picker already.
    const batch = (await list()).find((d) => d.brief === null && d.status === 'ready');
    const refused = await app.inject({ method: 'POST', url: `/api/demos/${batch!.id}/practice` });
    expect(refused.statusCode).toBe(409);
    const missing = await app.inject({
      method: 'POST',
      url: `/api/demos/${randomUUID()}/practice`,
    });
    expect(missing.statusCode).toBe(404);
  });

  it('writes a demo from a brief ahead of a batch already waiting', async () => {
    await queueDemos(db, ['hard-facilities-manager'], 2);
    const briefId = await queueBriefDemo(db, BRIEF);
    const first = await claimDemo(db);
    expect(first).toEqual({ id: briefId, kind: 'brief', brief: BRIEF });
    const second = await claimDemo(db);
    expect(second).toMatchObject({ kind: 'scenario', scenarioId: 'hard-facilities-manager' });
    // Settle what this test claimed, so nothing is left waiting.
    for (const job of [first, second, await claimDemo(db)]) {
      if (job) await failDemo(db, job.id, 'set aside by the route tests');
    }
    expect(await claimDemo(db)).toBeNull();
  });

  it('says why when demos cannot be written, and 404s an unknown demo', async () => {
    const off = await build(null);
    try {
      for (const [url, payload] of [
        ['/api/demos/generate', {}],
        ['/api/demos/retry', {}],
        ['/api/demos', { brief: BRIEF }],
      ] as const) {
        const res = await off.inject({ method: 'POST', url, payload });
        expect(res.statusCode).toBe(503);
        expect(res.json()).toEqual({ error: NO_DEMO_WRITER_MESSAGE });
      }
      const practice = await off.inject({
        method: 'POST',
        url: `/api/demos/${randomUUID()}/practice`,
      });
      expect(practice.statusCode).toBe(503);
      expect(practice.json()).toEqual({ error: NO_WRITER_MESSAGE });
    } finally {
      await off.close();
    }
    const missing = await app.inject({ method: 'GET', url: `/api/demos/${randomUUID()}` });
    expect(missing.statusCode).toBe(404);
    const bad = await app.inject({ method: 'GET', url: '/api/demos/not-a-uuid' });
    expect(bad.statusCode).toBe(400);
  });
});
