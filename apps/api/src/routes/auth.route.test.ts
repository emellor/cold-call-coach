import { CreateCallResponse, SessionResponse } from '@ccc/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { LOGIN_ATTEMPTS, SESSION_COOKIE } from '../auth.ts';
import { loadConfig } from '../config.ts';
import { createDb } from '../db/client.ts';
import { testCatalog } from '../test/catalog.ts';
import { deleteCall } from '../test/callLog.ts';
import { databaseAvailable, testDatabaseUrl } from '../test/db.ts';

const hasDb = await databaseAvailable();
const PASSWORD = 'correct horse battery';
const livekit = {
  LIVEKIT_URL: 'wss://test-project.livekit.cloud',
  LIVEKIT_API_KEY: 'APItestkey',
  LIVEKIT_API_SECRET: 'test-secret-that-is-long-enough-for-hs256-signing',
};

describe.skipIf(!hasDb)('APP_PASSWORD (real Postgres)', () => {
  const { pool, db } = createDb(testDatabaseUrl);
  let app: FastifyInstance;
  let open: FastifyInstance;

  beforeAll(async () => {
    const base = { DATABASE_URL: testDatabaseUrl, ...livekit };
    app = await buildApp(
      {
        config: loadConfig({
          ...base,
          APP_PASSWORD: PASSWORD,
          INTERNAL_API_SECRET: 'route-test-internal-secret',
        }),
        pool,
        db,
        catalog: testCatalog,
      },
      { webDistDir: '/nonexistent' },
    );
    open = await buildApp(
      { config: loadConfig(base), pool, db, catalog: testCatalog },
      { webDistDir: '/nonexistent' },
    );
  });
  afterAll(async () => {
    await app.close();
    await open.close();
    await pool.end();
  });

  const login = (password: string, remoteAddress = '10.0.0.1') =>
    app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password },
      remoteAddress,
    });
  const cookieOf = (setCookie: string | string[] | undefined) => String(setCookie).split(';')[0]!;

  it('refuses every /api route without a session, the LiveKit token included', async () => {
    for (const [method, url] of [
      ['GET', '/api/scenarios'],
      ['GET', '/api/calls'],
      ['POST', '/api/calls'],
    ] as const) {
      const res = await app.inject({
        method,
        url,
        ...(method === 'POST'
          ? { payload: { scenarioId: 'medium-finance-director', mode: 'coached' } }
          : {}),
      });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(res.json()).toEqual({ error: 'Sign in first.' });
    }
    // Health stays open for the host's checks, and says sign-in is needed.
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    expect(
      SessionResponse.parse((await app.inject({ method: 'GET', url: '/api/auth/session' })).json()),
    ).toEqual({ required: true, signedIn: false });
  });

  it('trades the password for an http-only session cookie that opens the API', async () => {
    const wrong = await login('battery horse');
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ error: 'That password is wrong.' });

    const right = await login(PASSWORD);
    expect(right.statusCode).toBe(204);
    const setCookie = String(right.headers['set-cookie']);
    expect(setCookie).toMatch(
      new RegExp(
        `^${SESSION_COOKIE}=\\d+\\.[\\w-]+; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000$`,
      ),
    );

    const cookie = cookieOf(right.headers['set-cookie']);
    const scenarios = await app.inject({
      method: 'GET',
      url: '/api/scenarios',
      headers: { cookie },
    });
    expect(scenarios.statusCode).toBe(200);
    const call = await app.inject({
      method: 'POST',
      url: '/api/calls',
      headers: { cookie },
      payload: { scenarioId: 'medium-finance-director', mode: 'coached' },
    });
    expect(call.statusCode).toBe(201);
    await deleteCall(db, CreateCallResponse.parse(call.json()).callId);
    expect(
      SessionResponse.parse(
        (await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } })).json(),
      ),
    ).toEqual({ required: true, signedIn: true });

    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect(out.statusCode).toBe(204);
    expect(String(out.headers['set-cookie'])).toContain(`${SESSION_COOKIE}=; Path=/`);
    expect(String(out.headers['set-cookie'])).toContain('Max-Age=0');
  });

  it('slows down guessing: too many wrong passwords from one address are refused for a while', async () => {
    const address = '10.9.9.9';
    for (let i = 0; i < LOGIN_ATTEMPTS; i++)
      expect((await login('nope', address)).statusCode).toBe(401);
    const locked = await login(PASSWORD, address);
    expect(locked.statusCode).toBe(429);
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
    expect((await login(PASSWORD, '10.9.9.10')).statusCode).toBe(204);
  });

  it('changes nothing locally, where no password is set', async () => {
    expect((await open.inject({ method: 'GET', url: '/api/scenarios' })).statusCode).toBe(200);
    expect(
      SessionResponse.parse(
        (await open.inject({ method: 'GET', url: '/api/auth/session' })).json(),
      ),
    ).toEqual({ required: false, signedIn: true });
  });
});
