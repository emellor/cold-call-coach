// What a call cost (PLAN.md §13, M6): the price table the API and the agent
// read from config/prices.json, and the per-call breakdown the web shows.
import { z } from 'zod';

const usd = z.number().nonnegative();

export const TokenPrice = z.object({
  input: usd,
  /** 5-minute cache writes: the only kind this app makes. */
  cacheWrite: usd,
  cacheRead: usd,
  output: usd,
});
export type TokenPrice = z.infer<typeof TokenPrice>;

export const PriceTable = z.object({
  /** When the prices were last checked. */
  asOf: z.iso.date(),
  /** A call costing more than this is flagged, live and in the history. */
  warnAboveUsd: usd,
  anthropic: z.object({
    source: z.string(),
    /** USD per million tokens, by model id (a dated id prices as its alias). */
    perMillionTokens: z.record(z.string(), TokenPrice),
  }),
  deepgram: z.object({ source: z.string(), perMinute: z.record(z.string(), usd) }),
  cartesia: z.object({ source: z.string(), per1kCharacters: z.record(z.string(), usd) }),
});
export type PriceTable = z.infer<typeof PriceTable>;

export const CostKey = z.enum(['prospect', 'judge', 'hint', 'review', 'stt', 'tts']);
export type CostKey = z.infer<typeof CostKey>;

/** One priced line of a call's cost. */
export const CostLine = z.object({
  key: CostKey,
  /** The model (Claude, Deepgram or Cartesia) that did the work. */
  model: z.string(),
  /** Tokens for Claude, minutes of audio for Deepgram, characters for Cartesia; null if unknown. */
  quantity: z.number().nonnegative().nullable(),
  unit: z.enum(['tokens', 'minutes', 'characters']),
  /** Claude lines: how many of the input tokens were read from the prompt cache. */
  cachedTokens: z.int().nonnegative().optional(),
  /** Null when the price table has no price for the model. */
  usd: usd.nullable(),
});
export type CostLine = z.infer<typeof CostLine>;

export const CostBreakdown = z.object({
  /** The sum of the priced lines. */
  totalUsd: usd,
  lines: z.array(CostLine),
  /** Some line had no price, so the total is a lower bound. */
  incomplete: z.boolean(),
  warnAboveUsd: usd,
  overBudget: z.boolean(),
});
export type CostBreakdown = z.infer<typeof CostBreakdown>;
