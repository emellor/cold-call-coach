import type { LaneUsage } from '@ccc/contracts';
import { describe, expect, it } from 'vitest';
import { cacheStats, latencyStats, percentile } from './latency.ts';

describe('percentile', () => {
  it('interpolates between the closest ranks', () => {
    const values = [900, 1_100, 1_300, 1_500, 2_600];
    expect(percentile(values, 50)).toBe(1_300);
    expect(percentile(values, 90)).toBe(2_160); // 1500 + (2600 − 1500) × 0.6
    expect(percentile([1_000, 2_000], 50)).toBe(1_500);
    expect(percentile([700], 90)).toBe(700);
    expect(percentile([], 50)).toBeNull();
  });
});

describe('latencyStats', () => {
  it('summarises each stage over the replies that measured it', () => {
    const stats = latencyStats([
      { turn: 0, endOfTurnMs: null, llmTtftMs: null, ttsTtfbMs: 150, e2eMs: null }, // her opening line
      { turn: 1, endOfTurnMs: 400, llmTtftMs: 700, ttsTtfbMs: 180, e2eMs: 1_300 },
      { turn: 2, endOfTurnMs: 600, llmTtftMs: 900, ttsTtfbMs: 220, e2eMs: 1_700 },
    ]);
    expect(stats.e2eMs).toEqual({ n: 2, p50: 1_500, p90: 1_660 });
    expect(stats.ttsTtfbMs).toEqual({ n: 3, p50: 180, p90: 212 });
    expect(stats.endOfTurnMs.n).toBe(2);
  });
});

describe('cacheStats', () => {
  const lane = (calls: number, cachedCalls?: number): LaneUsage => ({
    model: 'claude-opus-5',
    calls,
    ...(cachedCalls === undefined ? {} : { cachedCalls }),
    inputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  });

  it('counts cache reads, and the logs where caching broke after the first request', () => {
    expect(cacheStats([lane(12, 11), lane(8, 7), lane(9, 2), lane(4), undefined])).toEqual({
      calls: 29,
      cachedCalls: 20,
      uncachedCalls: 9,
      logsMissingAfterFirst: 1,
    });
  });
});
