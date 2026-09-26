import type { CallLog, LaneUsage } from '@ccc/contracts';
import { describe, expect, it } from 'vitest';
import { prices } from '../test/fixtures.ts';
import { costBreakdown, sttCostUsd, ttsCostUsd } from './cost.ts';

const lane = (costUsd: number | null, extra: Partial<LaneUsage> = {}): LaneUsage => ({
  model: 'claude-opus-5',
  calls: 12,
  inputTokens: 3_000,
  cacheReadInputTokens: 20_000,
  cacheCreationInputTokens: 2_000,
  outputTokens: 900,
  costUsd,
  ...extra,
});

describe('speech pricing', () => {
  it('prices Deepgram by the minute of audio and Cartesia by the thousand characters', () => {
    expect(sttCostUsd('nova-3', 600_000, prices)).toBe(0.077); // 10 minutes
    expect(ttsCostUsd('sonic-3', 2_400, prices)).toBe(0.12);
  });

  it('does not guess at a model the table lacks', () => {
    expect(sttCostUsd('nova-9', 60_000, prices)).toBeNull();
    expect(ttsCostUsd('sonic-9', 1_000, prices)).toBeNull();
  });
});

describe('costBreakdown', () => {
  const usage: CallLog['usage'] = {
    prospect: lane(0.0865),
    judge: lane(0.0421, { calls: 11 }),
    hint: lane(0.0112, { calls: 1 }),
    stt: { model: 'nova-3', audioMs: 540_000, costUsd: 0.0693 },
    tts: { model: 'sonic-3', characters: 2_150, costUsd: 0.1075 },
  };

  it('lists every line in a fixed order and adds them up', () => {
    const cost = costBreakdown(usage, { model: 'claude-opus-5', costUsd: 0.061 }, 2);
    expect(cost.lines.map((l) => [l.key, l.usd])).toEqual([
      ['prospect', 0.0865],
      ['judge', 0.0421],
      ['hint', 0.0112],
      ['review', 0.061],
      ['stt', 0.0693],
      ['tts', 0.1075],
    ]);
    expect(cost.totalUsd).toBe(0.3776);
    expect(cost.lines[0]).toMatchObject({ quantity: 25_900, unit: 'tokens', cachedTokens: 20_000 });
    expect(cost.lines.find((l) => l.key === 'stt')).toMatchObject({ quantity: 9, unit: 'minutes' });
    expect(cost).toMatchObject({ incomplete: false, overBudget: false, warnAboveUsd: 2 });
  });

  it('flags a call over the warning line, and a total missing an unpriced line', () => {
    const expensive = costBreakdown({ prospect: lane(2.4) }, null, 2);
    expect(expensive).toMatchObject({ totalUsd: 2.4, overBudget: true, incomplete: false });
    const unpriced = costBreakdown({ prospect: lane(null, { model: 'claude-x' }) }, null, 2);
    expect(unpriced).toMatchObject({ totalUsd: 0, incomplete: true });
  });

  it('is empty before the call log arrives', () => {
    expect(costBreakdown(null, null, 2)).toEqual({
      totalUsd: 0,
      lines: [],
      incomplete: false,
      warnAboveUsd: 2,
      overBudget: false,
    });
  });
});
