import { CreateCallResponse, DispatchMetadata, roomNameForCall } from '@ccc/contracts';
import { and, eq, gte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { TokenVerifier } from 'livekit-server-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { loadConfig } from '../config.ts';
import { createDb } from '../db/client.ts';
import { LOCAL_USER_ID, calls } from '../db/schema.ts';
import { databaseAvailable, testDatabaseUrl } from '../test/db.ts';
import { testCatalog } from '../test/catalog.ts';

const hasDb = await databaseAvailable();

const livekitEnv = {
  LIVEKIT_URL: 'wss://test-project.livekit.cloud',
  LIVEKIT_API_KEY: 'APItestkey',
  LIVEKIT_API_SECRET: 'test-secret-that-is-long-enough-for-hs256-signing',
};

describe.skipIf(!hasDb)('POST /api/calls (real Postgres)', () => {
  const { pool, db } = createDb(testDatabaseUrl);
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp(
      {
        config: loadConfig({ DATABASE_URL: testDatabaseUrl, ...livekitEnv }),
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

  it('creates a ringing call and returns a rep token that dispatches the prospect', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/calls',
      payload: { scenarioId: 'medium-finance-director', mode: 'coached' },
    });
    expect(res.statusCode).toBe(201);
    const body = CreateCallResponse.parse(res.json());
    expect(body.url).toBe(livekitEnv.LIVEKIT_URL);

    const [row] = await db.select().from(calls).where(eq(calls.id, body.callId));
    expect(row).toMatchObject({
      userId: LOCAL_USER_ID,
      scenarioId: 'medium-finance-director',
      scenarioVersion: 1,
      mode: 'coached',
      status: 'ringing',
      outcome: null,
    });

    const claims = await new TokenVerifier(
      livekitEnv.LIVEKIT_API_KEY,
      livekitEnv.LIVEKIT_API_SECRET,
    ).verify(body.token);
    expect(claims.sub).toBe('rep');
    expect(claims.video).toMatchObject({
      roomJoin: true,
      room: roomNameForCall(body.callId),
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    expect((claims.exp ?? 0) - (claims.nbf ?? 0)).toBe(15 * 60);

    const dispatch = claims.roomConfig?.agents[0];
    expect(dispatch?.agentName).toBe('prospect');
    expect(DispatchMetadata.parse(JSON.parse(dispatch?.metadata ?? ''))).toEqual({
      callId: body.callId,
      scenarioId: 'medium-finance-director',
      mode: 'coached',
    });
  });

  it('rejects an invalid mode with 400 and the zod issues', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/calls',
      payload: { scenarioId: 'medium-finance-director', mode: 'practice' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'Invalid request' });
  });

  it('answers 404 for a scenario it does not know', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/calls',
      payload: { scenarioId: 'nobody-home', mode: 'coached' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('answers 503 naming the missing LiveKit settings, without creating a call', async () => {
    const bare = await buildApp(
      {
        config: loadConfig({ DATABASE_URL: testDatabaseUrl, LIVEKIT_API_KEY: '' }),
        pool,
        db,
        catalog: testCatalog,
      },
      { webDistDir: '/nonexistent' },
    );
    // Other test files create calls concurrently, so count only exam calls started from now.
    const since = new Date(Date.now() - 1_000);
    const examCallsSince = () =>
      db.$count(calls, and(eq(calls.mode, 'exam'), gte(calls.startedAt, since)));
    const before = await examCallsSince();
    const res = await bare.inject({
      method: 'POST',
      url: '/api/calls',
      payload: { scenarioId: 'medium-finance-director', mode: 'exam' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json<{ error: string }>().error).toContain(
      'LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET',
    );
    expect(await examCallsSince()).toBe(before);
    await bare.close();
  });
});
