// What a Claude call cost, from its usage and the price table
// (config/prices.json, USD per million tokens). Cache writes are the 5-minute
// kind, the only one this app uses. Unknown models cost null rather than a guess.
import type { PriceTable, TokenPrice } from '@ccc/contracts';

export interface TokenUsage {
  inputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  outputTokens: number;
}

/** "claude-haiku-4-5-20251001" prices as "claude-haiku-4-5". */
const priceFor = (model: string, prices: PriceTable): TokenPrice | undefined => {
  const table = prices.anthropic.perMillionTokens;
  return table[model] ?? table[model.replace(/-\d{8}$/, '')];
};

/** Rounds to a millionth of a dollar, so sums of many calls don't drift. */
export const roundUsd = (dollars: number): number => Math.round(dollars * 1_000_000) / 1_000_000;

export function costUsd(model: string, usage: TokenUsage, prices: PriceTable): number | null {
  const price = priceFor(model, prices);
  if (!price) return null;
  return roundUsd(
    (usage.inputTokens * price.input +
      usage.cacheCreationInputTokens * price.cacheWrite +
      usage.cacheReadInputTokens * price.cacheRead +
      usage.outputTokens * price.output) /
      1_000_000,
  );
}
