import type { LaneUsage } from '@ccc/contracts';
import { describe, expect, it } from 'vitest';
import { type ReportCall, buildReport, formatReport } from './latency.ts';

const lane = (
  model: string,
  effort: LaneUsage['effort'],
  calls: number,
  cached: number,
): LaneUsage => ({
  model,
  effort,
  calls,
  cachedCalls: cached,
  inputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
});

const reply = (turn: number, e2eMs: number) => ({
  turn,
  endOfTurnMs: 400,
  llmTtftMs: e2eMs - 700,
  ttsTtfbMs: 200,
  e2eMs,
});

const call = (
  model: string,
  effort: LaneUsage['effort'],
  e2e: number[],
  costUsd: number | null,
): ReportCall => ({
  startedAt: new Date('2026-09-26T10:00:00Z'),
  durationMs: 300_000,
  latency: e2e.map((ms, i) => reply(i + 1, ms)),
  usage: {
    prospect: lane(model, effort, e2e.length + 1, e2e.length),
    judge: lane(model, 'low', e2e.length, e2e.length - 1),
  },
  costUsd,
});

describe('buildReport', () => {
  it('groups calls by the prospect’s model and effort, with p50/p90 per stage, cache hits and cost', () => {
    const groups = buildReport([
      call('claude-opus-5', 'low', [1_200, 1_400, 1_900], 0.61),
      call('claude-opus-5', 'low', [1_300, 2_600], 0.49),
      call('claude-haiku-4-5', undefined, [900, 1_000], 0.2),
    ]);
    expect(groups.map((g) => [g.prospect, g.calls, g.replies])).toEqual([
      ['claude-opus-5 @ low', 2, 5],
      ['claude-haiku-4-5 @ effort not recorded', 1, 2],
    ]);
    const opus = groups[0]!;
    expect(opus.stages.e2eMs).toEqual({ n: 5, p50: 1_400, p90: 2_320 });
    expect(opus.cache.prospect).toMatchObject({
      calls: 7,
      cachedCalls: 5,
      logsMissingAfterFirst: 0,
    });
    expect(opus.cost).toEqual({ calls: 2, meanUsd: 0.55, maxUsd: 0.61, per10MinUsd: 1.1 });
  });
});

describe('formatReport', () => {
  it('prints a markdown table per group, with the target verdict and the levers when it misses', () => {
    const text = formatReport(
      buildReport([call('claude-opus-5', 'low', [1_300, 1_900, 2_700], 0.7)]),
      {
        from: new Date('2026-09-26T10:00:00Z'),
        to: new Date('2026-09-26T11:00:00Z'),
      },
    );
    expect(text).toContain('## Prospect on claude-opus-5 @ low: 1 call, 3 replies');
    expect(text).toContain('| End to end | 3 | 1,900 ms | 2,540 ms |');
    expect(text).toContain('End to end misses the target');
    expect(text).toContain('p50 is 400 ms over');
    expect(text).toContain('PROSPECT_MODEL=claude-haiku-4-5');
    expect(text).toContain(
      '- Prospect: 3 of 4 requests read the prompt cache (every call read it from its second request on).',
    );
    expect(text).toContain('Cost: $0.70 a call on average');
  });

  it('says when a group meets the target, and when there is nothing to report', () => {
    expect(
      formatReport(buildReport([call('claude-opus-5', 'low', [1_000, 1_200], 0.5)]), null),
    ).toContain('End to end meets the target');
    expect(formatReport([], null)).toMatch(/^No ended calls with a log yet/);
    const unpriced = formatReport(buildReport([call('claude-opus-5', 'low', [1_000], null)]), null);
    expect(unpriced).toContain('## Prospect on claude-opus-5 @ low: 1 call, 1 reply');
    expect(unpriced).toContain('Cost: none of these calls was priced.');
  });

  it('keeps calls that never reached Claude apart, counting only her measured lines', () => {
    // She picked up, but her voice failed: the greeting's entry has nothing measured.
    const failed: ReportCall = {
      startedAt: new Date('2026-09-26T10:00:00Z'),
      durationMs: 15_000,
      latency: [{ turn: 0, endOfTurnMs: null, llmTtftMs: null, ttsTtfbMs: null, e2eMs: null }],
      usage: {},
      costUsd: null,
    };
    const text = formatReport(buildReport([failed, failed]), null);
    expect(text).toContain('## Calls with no reply from Claude: 2 calls, 0 replies');
    expect(text).toContain('- No Claude requests, so nothing to cache.');
  });
});
