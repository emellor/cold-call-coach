import { HealthResponse } from '@ccc/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { loadConfig } from '../config.ts';
import { createDb } from '../db/client.ts';
import { databaseAvailable, testDatabaseUrl } from '../test/db.ts';

const hasDb = await databaseAvailable();
const noWeb = '/nonexistent-web-dist';

describe.skipIf(!hasDb)('GET /api/health (real Postgres)', () => {
  const { pool, db } = createDb(testDatabaseUrl);
  afterAll(() => pool.end());

  it('reports ok including the database round-trip', async () => {
    const app = await buildApp(
      { config: loadConfig({ DATABASE_URL: testDatabaseUrl }), pool, db },
      { webDistDir: noWeb },
    );
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = HealthResponse.parse(res.json());
    expect(body.ok).toBe(true);
    expect(body.db.ok).toBe(true);
    expect(body.db.latencyMs).toBeGreaterThanOrEqual(0);
    await app.close();
  });
});

describe('GET /api/health without a database', () => {
  it('answers 503 with the database error instead of hanging or crashing', async () => {
    const deadUrl = 'postgres://coach:coach@127.0.0.1:1/coach';
    const { pool, db } = createDb(deadUrl);
    const app = await buildApp(
      { config: loadConfig({ DATABASE_URL: deadUrl }), pool, db },
      { webDistDir: noWeb },
    );
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(503);
    const body = HealthResponse.parse(res.json());
    expect(body).toMatchObject({ ok: false, db: { ok: false } });
    expect(body.db.error).toBeTruthy();
    await app.close();
    await pool.end();
  });
});
