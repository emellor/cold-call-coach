// The latency report (PLAN.md §13, M6): p50 and p90 for each stage of her
// replies, and how often each Claude lane read its prompt cache, over logged calls.
import type { DebugLatencyPayload, LaneUsage } from '@ccc/contracts';

export const LATENCY_STAGES = ['endOfTurnMs', 'llmTtftMs', 'ttsTtfbMs', 'e2eMs'] as const;
export type LatencyStage = (typeof LATENCY_STAGES)[number];

/** PLAN.md §13: the rep stops speaking → her first audio. */
export const E2E_TARGET_MS = { p50: 1_500, p90: 2_500 } as const;

/** The p-th percentile, interpolating between the closest ranks; null for no values. */
export function percentile(values: readonly number[], p: number): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const low = sorted[lo]!;
  return Math.round(low + (sorted[hi]! - low) * (rank - lo));
}

export interface StageStats {
  /** Replies that measured this stage. */
  n: number;
  p50: number | null;
  p90: number | null;
}

export function latencyStats(
  entries: readonly DebugLatencyPayload[],
): Record<LatencyStage, StageStats> {
  const stats = {} as Record<LatencyStage, StageStats>;
  for (const stage of LATENCY_STAGES) {
    const values = entries.flatMap((e) => (e[stage] === null ? [] : [e[stage]]));
    stats[stage] = { n: values.length, p50: percentile(values, 50), p90: percentile(values, 90) };
  }
  return stats;
}

export interface CacheStats {
  calls: number;
  /** Calls that read from the prompt cache. */
  cachedCalls: number;
  /** Calls that didn't: at most one per call log (her first reply writes the cache). */
  uncachedCalls: number;
  /** Logs whose lane missed the cache after its first request: caching isn't working there. */
  logsMissingAfterFirst: number;
}

/** How the lane's requests used the prompt cache, over call logs that recorded it. */
export function cacheStats(lanes: ReadonlyArray<LaneUsage | undefined>): CacheStats {
  const stats: CacheStats = {
    calls: 0,
    cachedCalls: 0,
    uncachedCalls: 0,
    logsMissingAfterFirst: 0,
  };
  for (const lane of lanes) {
    if (!lane || lane.cachedCalls === undefined) continue;
    stats.calls += lane.calls;
    stats.cachedCalls += lane.cachedCalls;
    const uncached = lane.calls - lane.cachedCalls;
    stats.uncachedCalls += uncached;
    if (uncached > 1) stats.logsMissingAfterFirst += 1;
  }
  return stats;
}
