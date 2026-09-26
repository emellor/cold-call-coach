import { describe, expect, it } from 'vitest';
import { prices } from '../test/fixtures.ts';
import { costUsd } from './pricing.ts';

const usage = {
  inputTokens: 1_000_000,
  cacheCreationInputTokens: 1_000_000,
  cacheReadInputTokens: 1_000_000,
  outputTokens: 1_000_000,
};

describe('costUsd', () => {
  it('prices each token kind at its own rate', () => {
    // Opus 5: $5 in, $6.25 cache write, $0.50 cache read, $25 out, per MTok.
    expect(costUsd('claude-opus-5', usage, prices)).toBe(36.75);
    // Haiku 4.5: $1, $1.25, $0.10, $5.
    expect(costUsd('claude-haiku-4-5', usage, prices)).toBe(7.35);
  });

  it('prices a dated model id like its alias, and a typical judge call in fractions of a cent', () => {
    expect(costUsd('claude-haiku-4-5-20251001', usage, prices)).toBe(7.35);
    expect(
      costUsd(
        'claude-opus-5',
        {
          inputTokens: 900,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 700,
          outputTokens: 120,
        },
        prices,
      ),
    ).toBe(0.00785);
  });

  it('does not guess at unknown models', () => {
    expect(costUsd('claude-unknown-9', usage, prices)).toBeNull();
  });
});
