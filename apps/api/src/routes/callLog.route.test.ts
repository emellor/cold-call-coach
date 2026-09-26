import {
  CallDetail,
  CallListResponse,
  CallLogResponse,
  INTERNAL_SECRET_HEADER,
} from '@ccc/contracts';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { loadConfig } from '../config.ts';
import { createDb } from '../db/client.ts';
import { calls, events, reviews, turns } from '../db/schema.ts';
import { NO_REVIEWER_MESSAGE } from '../review/queue.ts';
import type { Reviewer } from '../review/reviewer.ts';
import { testCatalog } from '../test/catalog.ts';
import { createCall, deleteCall, sampleLog, stubReviewer } from '../test/callLog.ts';
import { databaseAvailable, testDatabaseUrl } from '../test/db.ts';

const hasDb = await databaseAvailable();
const SECRET = 'route-test-internal-secret';
const auth = { [INTERNAL_SECRET_HEADER]: SECRET };

describe.skipIf(!hasDb)('the call log and its review (real Postgres)', () => {
  const { pool, db } = createDb(testDatabaseUrl);
  const created: string[] = [];
  const apps: FastifyInstance[] = [];

  async function appWith(reviewer: Reviewer | null) {
    const app = await buildApp(
      {
        config: loadConfig({ DATABASE_URL: testDatabaseUrl, INTERNAL_API_SECRET: SECRET }),
        pool,
        db,
        catalog: testCatalog,
        reviewer,
      },
      { webDistDir: '/nonexistent' },
    );
    apps.push(app);
    return app;
  }
  async function newCall() {
    const id = await createCall(db);
    created.push(id);
    return id;
  }
  const post = (
    app: FastifyInstance,
    id: string,
    payload: unknown,
    headers: Record<string, string> = auth,
  ) =>
    app.inject({
      method: 'POST',
      url: `/internal/calls/${id}/log`,
      payload: payload as object,
      headers,
    });
  const detail = async (app: FastifyInstance, id: string) =>
    CallDetail.parse((await app.inject({ method: 'GET', url: `/api/calls/${id}` })).json());

  afterAll(async () => {
    for (const app of apps) await app.close();
    for (const id of created) await deleteCall(db, id);
    await pool.end();
  });

  it('stores the log, reviews the call and serves the scorecard with only real quotes', async () => {
    const { reviewer, calls: asked } = stubReviewer();
    const app = await appWith(reviewer);
    const id = await newCall();

    const res = await post(app, id, sampleLog());
    expect(res.statusCode).toBe(200);
    expect(CallLogResponse.parse(res.json())).toEqual({ ok: true, review: 'pending' });
    await app.reviewQueue.idle();

    const call = await detail(app, id);
    expect(call.call).toMatchObject({
      status: 'ended',
      outcome: 'hung_up_by_prospect',
      durationMs: 90_000,
    });
    expect(call.outcomeReason).toBe('Out of patience');
    expect(call.turns.map((t) => [t.idx, t.speaker])).toEqual([
      [0, 'prospect'],
      [1, 'rep'],
      [2, 'prospect'],
      [3, 'rep'],
      [4, 'prospect'],
    ]);
    expect(call.turns[1]?.stateAfter).toEqual({
      turn: 1,
      interest: 20,
      patience: 44,
      painsRevealed: [],
    });
    expect(call.metrics).toMatchObject({ durationSec: 90, coreFillers: 1, questionsClosed: 1 });

    expect(call.review).toMatchObject({
      status: 'ready',
      model: 'claude-opus-5',
      costUsd: 0.0625,
      error: null,
    });
    const result = call.review?.result;
    expect(result?.stages.find((s) => s.key === 'opener')?.evidence).toEqual([
      { turn: 2, quote: 'sorry to bother you' },
    ]);
    expect(result?.quotesDropped).toBe(1);
    expect(result?.objections).toHaveLength(1);

    // The review was given the numbered transcript and the measured metrics.
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      outcome: 'hung_up_by_prospect',
      metrics: { durationSec: 90 },
    });

    const [row] = await db.select().from(calls).where(eq(calls.id, id));
    expect(row?.costUsd).toBeCloseTo(0.027);
  });

  it('is idempotent: posting the same log twice leaves the same call and one review', async () => {
    const { reviewer, calls: asked } = stubReviewer();
    const app = await appWith(reviewer);
    const id = await newCall();

    await post(app, id, sampleLog());
    await app.reviewQueue.idle();
    const first = await detail(app, id);
    const counts = async () => ({
      turns: await db.$count(turns, eq(turns.callId, id)),
      events: await db.$count(events, eq(events.callId, id)),
      reviews: await db.$count(reviews, eq(reviews.callId, id)),
    });
    const before = await counts();

    const again = await post(app, id, sampleLog());
    expect(CallLogResponse.parse(again.json()).review).toBe('ready');
    await app.reviewQueue.idle();
    expect(await detail(app, id)).toEqual(first);
    expect(await counts()).toEqual(before);
    expect(before).toEqual({ turns: 5, events: 3, reviews: 1 });
    expect(asked).toHaveLength(1);
  });

  it('replaces an earlier log wholesale when the agent posts a longer one', async () => {
    const app = await appWith(stubReviewer().reviewer);
    const id = await newCall();
    const log = sampleLog();
    await post(app, id, { ...log, turns: log.turns.slice(0, 2), events: [] });
    await post(app, id, log);
    await app.reviewQueue.idle();
    expect((await detail(app, id)).turns).toHaveLength(5);
  });

  it('skips the review of a call she never answered', async () => {
    const { reviewer, calls: asked } = stubReviewer();
    const app = await appWith(reviewer);
    const id = await newCall();
    await post(
      app,
      id,
      sampleLog({ connectedAt: null, durationMs: 0, turns: [], outcome: 'error' }),
    );
    await app.reviewQueue.idle();
    expect((await detail(app, id)).review).toMatchObject({
      status: 'skipped',
      error: 'She never picked up, so there is nothing to review.',
    });
    expect(asked).toHaveLength(0);
  });

  it('skips the review of a call where the rep said nothing', async () => {
    const { reviewer, calls: asked } = stubReviewer();
    const app = await appWith(reviewer);
    const id = await newCall();
    await post(
      app,
      id,
      sampleLog({ turns: sampleLog().turns.slice(0, 1), outcome: 'ended_by_rep' }),
    );
    await app.reviewQueue.idle();
    expect((await detail(app, id)).review).toMatchObject({ status: 'skipped', result: null });
    expect(asked).toHaveLength(0);
  });

  it('fails the review with a reason when the API has no Claude key, and reruns it on request', async () => {
    const off = await appWith(null);
    const id = await newCall();
    await post(off, id, sampleLog());
    await off.reviewQueue.idle();
    expect((await detail(off, id)).review).toMatchObject({
      status: 'failed',
      error: NO_REVIEWER_MESSAGE,
    });

    const { reviewer, calls: asked } = stubReviewer();
    const on = await appWith(reviewer);
    const rerun = await on.inject({ method: 'POST', url: `/api/calls/${id}/review/rerun` });
    expect(rerun.statusCode).toBe(202);
    expect(rerun.json()).toEqual({ status: 'pending' });
    await on.reviewQueue.idle();
    expect((await detail(on, id)).review?.status).toBe('ready');
    expect(asked).toHaveLength(1);
  });

  it('re-queues a failed review when the log is posted again', async () => {
    let fail = true;
    const { reviewer: ok } = stubReviewer();
    const flaky: Reviewer = (input) => (fail ? Promise.reject(new Error('overloaded')) : ok(input));
    const app = await appWith(flaky);
    const id = await newCall();
    await post(app, id, sampleLog());
    await app.reviewQueue.idle();
    expect((await detail(app, id)).review).toMatchObject({ status: 'failed', error: 'overloaded' });
    fail = false;
    expect(CallLogResponse.parse((await post(app, id, sampleLog())).json()).review).toBe('pending');
    await app.reviewQueue.idle();
    expect((await detail(app, id)).review?.status).toBe('ready');
  });

  it('guards the internal route and validates the log', async () => {
    const app = await appWith(stubReviewer().reviewer);
    const id = await newCall();
    expect((await post(app, id, sampleLog(), {})).statusCode).toBe(401);
    expect((await post(app, '00000000-0000-4000-8000-000000000000', sampleLog())).statusCode).toBe(
      404,
    );
    const log = sampleLog();
    const repeated = { ...log, turns: [log.turns[0], log.turns[0]] };
    expect((await post(app, id, repeated)).statusCode).toBe(400);
    const backwards = { ...log, turns: [{ ...log.turns[0], startMs: 900, endMs: 100 }] };
    expect((await post(app, id, backwards)).statusCode).toBe(400);
  });

  it('refuses to rerun a review before the log has arrived, or for an unknown call', async () => {
    const app = await appWith(stubReviewer().reviewer);
    const id = await newCall();
    expect(
      (await app.inject({ method: 'POST', url: `/api/calls/${id}/review/rerun` })).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/calls/00000000-0000-4000-8000-000000000000/review/rerun',
        })
      ).statusCode,
    ).toBe(404);
    const pending = await detail(app, id);
    expect(pending.metrics).toBeNull();
    expect(pending.review).toBeNull();
  });

  it('lists calls newest first with scenario, outcome, score and duration', async () => {
    const app = await appWith(stubReviewer().reviewer);
    const id = await newCall();
    await post(app, id, sampleLog());
    await app.reviewQueue.idle();
    const { calls: list } = CallListResponse.parse(
      (await app.inject({ method: 'GET', url: '/api/calls' })).json(),
    );
    const mine = list.find((c) => c.id === id);
    expect(mine).toMatchObject({
      outcome: 'hung_up_by_prospect',
      durationMs: 90_000,
      overallScore: 22,
      reviewStatus: 'ready',
      scenario: {
        id: 'medium-finance-director',
        title: 'Busy finance director',
        difficulty: 'medium',
        prospectName: 'Claire Hughes',
      },
    });
    const times = list.map((c) => Date.parse(c.startedAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });
});
