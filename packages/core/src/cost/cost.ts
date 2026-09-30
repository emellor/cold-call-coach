// A call's cost (PLAN.md §13): Claude per lane (the review included), Deepgram
// by the minute and Cartesia by the character, priced from config/prices.json.
// Lines are priced when the work is done and stored; the breakdown only adds
// up what was stored, so a later price change doesn't rewrite old calls.
import type { CallLog, CostBreakdown, CostLine, LaneUsage, PriceTable } from '@ccc/contracts';
import { roundUsd } from '../claude/pricing.ts';

export function sttCostUsd(model: string, audioMs: number, prices: PriceTable): number | null {
  const perMinute = prices.deepgram.perMinute[model];
  return perMinute === undefined ? null : roundUsd((audioMs / 60_000) * perMinute);
}

export function ttsCostUsd(model: string, characters: number, prices: PriceTable): number | null {
  const per1k = prices.cartesia.per1kCharacters[model];
  return per1k === undefined ? null : roundUsd((characters / 1000) * per1k);
}

const tokensOf = (lane: LaneUsage) =>
  lane.inputTokens + lane.cacheReadInputTokens + lane.cacheCreationInputTokens + lane.outputTokens;

/** Every line of a call's cost, in a fixed order, from its stored usage and review. */
export function costLines(
  usage: CallLog['usage'] | null,
  review: { model: string | null; costUsd: number | null } | null,
): CostLine[] {
  const lines: CostLine[] = [];
  for (const key of ['prospect', 'rep', 'judge', 'hint'] as const) {
    const lane = usage?.[key];
    if (!lane) continue;
    lines.push({
      key,
      model: lane.model,
      quantity: tokensOf(lane),
      unit: 'tokens',
      cachedTokens: lane.cacheReadInputTokens,
      usd: lane.costUsd,
    });
  }
  if (review?.model) {
    lines.push({
      key: 'review',
      model: review.model,
      quantity: null,
      unit: 'tokens',
      usd: review.costUsd,
    });
  }
  if (usage?.stt) {
    lines.push({
      key: 'stt',
      model: usage.stt.model,
      quantity: Math.round((usage.stt.audioMs / 60_000) * 100) / 100,
      unit: 'minutes',
      usd: usage.stt.costUsd,
    });
  }
  if (usage?.tts) {
    lines.push({
      key: 'tts',
      model: usage.tts.model,
      quantity: usage.tts.characters,
      unit: 'characters',
      usd: usage.tts.costUsd,
    });
  }
  return lines;
}

/** The sum of the lines that could be priced. */
export const totalUsd = (lines: readonly CostLine[]): number =>
  roundUsd(lines.reduce((sum, line) => sum + (line.usd ?? 0), 0));

export function costBreakdown(
  usage: CallLog['usage'] | null,
  review: { model: string | null; costUsd: number | null } | null,
  warnAboveUsd: number,
): CostBreakdown {
  const lines = costLines(usage, review);
  const total = totalUsd(lines);
  return {
    totalUsd: total,
    lines,
    incomplete: lines.some((line) => line.usd === null),
    warnAboveUsd,
    overBudget: total > warnAboveUsd,
  };
}
