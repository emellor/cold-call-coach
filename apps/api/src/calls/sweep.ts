// Calls that never reported back. The agent posts every call's log when the
// call ends, but a crashed worker or a lost machine can't; past the longest a
// call can run, such a call is marked failed so the history says so. A log
// that arrives later still replaces it (the log upsert wins).
import { MAX_CALL_SECONDS } from '@ccc/contracts';
import { and, lt, ne } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { calls } from '../db/schema.ts';

/** The call limit, plus time for ringing, set-up and the log to arrive. */
export const STALE_CALL_MS = (MAX_CALL_SECONDS + 5 * 60) * 1000;

export const STALE_CALL_REASON =
  'The voice agent never reported how this call ended; it may have crashed or lost its connection.';

/** Marks calls started more than STALE_CALL_MS ago and still not ended as failed; returns how many. */
export async function sweepStaleCalls(db: Db, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_CALL_MS);
  const swept = await db
    .update(calls)
    .set({ status: 'ended', outcome: 'error', outcomeReason: STALE_CALL_REASON, endedAt: now })
    .where(and(ne(calls.status, 'ended'), lt(calls.startedAt, cutoff)))
    .returning({ id: calls.id });
  return swept.length;
}
