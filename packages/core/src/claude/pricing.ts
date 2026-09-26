// What a Claude call cost, from its usage. USD per million tokens, from
// platform.claude.com/docs/en/about-claude/pricing (read 26 Sep 2026). Cache
// writes are the 5-minute kind, the only one this app uses. Unknown models
// cost null rather than a guess.

export interface TokenUsage {
  inputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  outputTokens: number;
}

interface Price {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

const PRICES: Record<string, Price> = {
  'claude-fable-5-1': { input: 10, cacheWrite: 12.5, cacheRead: 0.25, output: 50 },
  'claude-fable-5': { input: 10, cacheWrite: 12.5, cacheRead: 1, output: 50 },
  'claude-opus-5-5': { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 },
  'claude-opus-5': { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  'claude-opus-4-8': { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  'claude-opus-4-7': { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  'claude-opus-4-6': { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  'claude-sonnet-5': { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 },
  'claude-sonnet-4-6': { input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 },
  'claude-haiku-4-5': { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 },
};

/** "claude-haiku-4-5-20251001" prices as "claude-haiku-4-5". */
const priceFor = (model: string): Price | undefined =>
  PRICES[model] ?? PRICES[model.replace(/-\d{8}$/, '')];

export function costUsd(model: string, usage: TokenUsage): number | null {
  const price = priceFor(model);
  if (!price) return null;
  const dollars =
    (usage.inputTokens * price.input +
      usage.cacheCreationInputTokens * price.cacheWrite +
      usage.cacheReadInputTokens * price.cacheRead +
      usage.outputTokens * price.output) /
    1_000_000;
  return Math.round(dollars * 1_000_000) / 1_000_000;
}
