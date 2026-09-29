import { randomUUID } from 'node:crypto';
import { CheatSheetDetail, CheatSheetListResponse, CreateCheatSheetResponse } from '@ccc/contracts';
import { notInArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { NO_CHEAT_SHEET_WRITER_MESSAGE } from '../cheatSheets/writer.ts';
import { loadConfig } from '../config.ts';
import { createDb } from '../db/client.ts';
import { cheatSheets } from '../db/schema.ts';
import { sheetDraft, stubCheatSheetWriter } from '../test/cheatSheets.ts';
import { testCatalog } from '../test/catalog.ts';
import { databaseAvailable, testDatabaseUrl } from '../test/db.ts';

const hasDb = await databaseAvailable();
const BRIEF =
  'Sarah Patel, Head of Estates at Carewell, 14 care homes in Yorkshire. Objective: a 20-minute call.';

describe.skipIf(!hasDb)('cheat sheet routes (real Postgres)', () => {
  const { pool, db } = createDb(testDatabaseUrl);
  const stub = stubCheatSheetWriter();
  let app: FastifyInstance;
  let before: string[] = [];

  const build = (cheatSheetWriter: typeof stub.writer | null) =>
    buildApp(
      {
        config: loadConfig({ DATABASE_URL: testDatabaseUrl }),
        pool,
        db,
        catalog: testCatalog,
        prospectWriter: null,
        demoWriter: null,
        cheatSheetWriter,
      },
      { webDistDir: '/nonexistent' },
    );
  const list = async () =>
    CheatSheetListResponse.parse(
      (await app.inject({ method: 'GET', url: '/api/cheat-sheets' })).json(),
    ).sheets.filter((s) => !before.includes(s.id));

  beforeAll(async () => {
    // Sheets someone already had in this database are left as they are.
    before = (await db.select({ id: cheatSheets.id }).from(cheatSheets)).map((s) => s.id);
    app = await build(stub.writer);
  });

  afterAll(async () => {
    await app.close();
    await db
      .delete(cheatSheets)
      .where(before.length ? notInArray(cheatSheets.id, before) : sql`true`);
    await pool.end();
  });

  it('writes a sheet from the rep’s profile, keeps it, lists it and deletes it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/cheat-sheets',
      payload: { brief: `  ${BRIEF}  ` },
    });
    expect(res.statusCode).toBe(201);
    const { id } = CreateCheatSheetResponse.parse(res.json());
    expect(stub.briefs).toEqual([BRIEF]);

    expect(await list()).toEqual([
      expect.objectContaining({ id, title: sheetDraft.title, goal: sheetDraft.goal }),
    ]);
    const sheet = CheatSheetDetail.parse(
      (await app.inject({ method: 'GET', url: `/api/cheat-sheets/${id}` })).json(),
    );
    expect(sheet).toMatchObject({ id, brief: BRIEF, sheet: sheetDraft, costUsd: 0.05 });

    const gone = await app.inject({ method: 'DELETE', url: `/api/cheat-sheets/${id}` });
    expect(gone.statusCode).toBe(204);
    expect(await list()).toEqual([]);
    const again = await app.inject({ method: 'DELETE', url: `/api/cheat-sheets/${id}` });
    expect(again.statusCode).toBe(404);
  });

  it('says why a sheet was not written, and keeps nothing', async () => {
    const short = await app.inject({
      method: 'POST',
      url: '/api/cheat-sheets',
      payload: { brief: 'Too short' },
    });
    expect(short.statusCode).toBe(400);
    expect(short.json()).toEqual({
      error: 'Say a little more: who you are calling, their business and what you want.',
    });

    stub.failWith('Claude answered 400: Your credit balance is too low');
    const failed = await app.inject({
      method: 'POST',
      url: '/api/cheat-sheets',
      payload: { brief: BRIEF },
    });
    stub.failWith(null);
    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toEqual({ error: 'Claude answered 400: Your credit balance is too low' });
    expect(await list()).toEqual([]);

    const off = await build(null);
    try {
      const refused = await off.inject({
        method: 'POST',
        url: '/api/cheat-sheets',
        payload: { brief: BRIEF },
      });
      expect(refused.statusCode).toBe(503);
      expect(refused.json()).toEqual({ error: NO_CHEAT_SHEET_WRITER_MESSAGE });
    } finally {
      await off.close();
    }
    const missing = await app.inject({ method: 'GET', url: `/api/cheat-sheets/${randomUUID()}` });
    expect(missing.statusCode).toBe(404);
  });
});
