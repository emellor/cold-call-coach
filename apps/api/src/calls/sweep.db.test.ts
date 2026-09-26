import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.ts';
import { calls } from '../db/schema.ts';
import { createCall, deleteCall } from '../test/callLog.ts';
import { databaseAvailable, testDatabaseUrl } from '../test/db.ts';
import { STALE_CALL_MS, STALE_CALL_REASON, sweepStaleCalls } from './sweep.ts';

const hasDb = await databaseAvailable();

describe.skipIf(!hasDb)('sweepStaleCalls (real Postgres)', () => {
  const { pool, db } = createDb(testDatabaseUrl);
  const created: string[] = [];
  afterAll(async () => {
    for (const id of created) await deleteCall(db, id);
    await pool.end();
  });

  it('fails a call that never reported back, and leaves live and finished calls alone', async () => {
    const now = new Date();
    const at = (msAgo: number) => new Date(now.getTime() - msAgo);
    const stale = await createCall(db);
    const live = await createCall(db);
    const finished = await createCall(db);
    created.push(stale, live, finished);
    await db
      .update(calls)
      .set({ startedAt: at(STALE_CALL_MS + 60_000) })
      .where(eq(calls.id, stale));
    await db
      .update(calls)
      .set({ startedAt: at(10 * 60_000) })
      .where(eq(calls.id, live));
    await db
      .update(calls)
      .set({ startedAt: at(STALE_CALL_MS * 2), status: 'ended', outcome: 'ended_by_rep' })
      .where(eq(calls.id, finished));

    expect(await sweepStaleCalls(db, now)).toBeGreaterThanOrEqual(1);
    const rows = await db
      .select({
        id: calls.id,
        status: calls.status,
        outcome: calls.outcome,
        reason: calls.outcomeReason,
      })
      .from(calls)
      .where(inArray(calls.id, created));
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(stale)).toMatchObject({
      status: 'ended',
      outcome: 'error',
      reason: STALE_CALL_REASON,
    });
    expect(byId.get(live)).toMatchObject({ status: 'ringing', outcome: null });
    expect(byId.get(finished)).toMatchObject({ status: 'ended', outcome: 'ended_by_rep' });
  });
});
