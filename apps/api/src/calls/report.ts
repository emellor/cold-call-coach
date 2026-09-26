// The logged calls the latency report reads (scripts/latency-report.ts).
import { CallLog, DebugLatencyPayload } from '@ccc/contracts';
import { roundUsd } from '@ccc/core';
import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { calls, reviews } from '../db/schema.ts';

export interface LoggedCall {
  startedAt: Date;
  durationMs: number | null;
  latency: DebugLatencyPayload[];
  usage: CallLog['usage'];
  /** Priced during the call and by its review; null if nothing could be priced. */
  costUsd: number | null;
}

const Latency = DebugLatencyPayload.array();
const Usage = CallLog.shape.usage;

/** The most recent ended calls she answered, newest first. */
export async function loggedCalls(
  db: Db,
  options: { limit: number; since: Date | null },
): Promise<LoggedCall[]> {
  const rows = await db
    .select({
      startedAt: calls.startedAt,
      durationMs: calls.durationMs,
      latency: calls.latency,
      usage: calls.usage,
      liveCostUsd: calls.costUsd,
      reviewCostUsd: reviews.costUsd,
    })
    .from(calls)
    .leftJoin(reviews, eq(reviews.callId, calls.id))
    .where(
      and(
        eq(calls.status, 'ended'),
        isNotNull(calls.connectedAt),
        options.since ? gte(calls.startedAt, options.since) : sql`true`,
      ),
    )
    .orderBy(desc(calls.startedAt))
    .limit(options.limit);
  return rows.map((row) => ({
    startedAt: row.startedAt,
    durationMs: row.durationMs,
    latency: Latency.safeParse(row.latency).data ?? [],
    usage: Usage.safeParse(row.usage).data ?? {},
    costUsd:
      row.liveCostUsd === null && row.reviewCostUsd === null
        ? null
        : roundUsd((row.liveCostUsd ?? 0) + (row.reviewCostUsd ?? 0)),
  }));
}
