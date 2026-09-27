// Runs the post-call review (the API's own reviewer and quote validation) on
// a simulated call, so `pnpm simulate --review` shows a real ReviewResult
// without a microphone.
import type {
  CallOutcome,
  PriceTable,
  ProductSpec,
  ReviewResult,
  RubricSpec,
  ScenarioSpec,
} from '@ccc/contracts';
import {
  type DroppedQuote,
  type Effort,
  type MetricTurn,
  type ReviewTranscriptTurn,
  type TurnReaction,
  computeMetrics,
  finalizeReview,
} from '@ccc/core';
import type { JudgedTurn } from '../../apps/agent/src/prospect/brain.ts';
import { type StreamingMessages, claudeReviewer } from '../../apps/api/src/review/reviewer.ts';
import type { SimOutcome, SimResult } from './harness.ts';

const GAP_MS = 600;
/** Speaking rates for laying a text-only call out in time: 150 and 160 words a minute. */
const REP_WPS = 2.5;
const HER_WPS = 2.7;

const OUTCOMES: Record<SimOutcome, CallOutcome> = {
  meeting_booked: 'meeting_booked',
  hung_up_by_prospect: 'hung_up_by_prospect',
  no_decision: 'ended_by_rep',
};

/** The simulated call as timed turns, opening line first. */
export function timedTurns(result: SimResult, openingLine: string): MetricTurn[] {
  const turns: MetricTurn[] = [];
  let at = 0;
  const say = (speaker: MetricTurn['speaker'], text: string, wordsPerSecond: number) => {
    const ms = Math.max(
      400,
      Math.round((text.split(/\s+/).filter(Boolean).length / wordsPerSecond) * 1000),
    );
    turns.push({ speaker, text, startMs: at, endMs: at + ms, interrupted: false });
    at += ms + GAP_MS;
  };
  say('prospect', openingLine, HER_WPS);
  for (const turn of result.turns) {
    say('rep', turn.rep, REP_WPS);
    if (turn.prospect) say('prospect', turn.prospect, HER_WPS);
  }
  return turns;
}

/** How she took a rep turn, as a real call's judgement event would record it. */
export function reactionOf(judged: JudgedTurn): TurnReaction {
  const { judge, before, after } = judged;
  return {
    interest: [before.interest, after.interest],
    patience: [before.patience, after.patience],
    reading: judged.judged
      ? {
          stage: judge.stage,
          signals: Object.entries(judge.signals)
            .filter(([, on]) => on)
            .map(([name]) => name),
          revealed: judge.revealEarned,
        }
      : null,
  };
}

/** The timed turns for the review, each rep turn with how she took it. */
function reviewTurns(turns: readonly MetricTurn[], result: SimResult): ReviewTranscriptTurn[] {
  let repTurn = 0;
  return turns.map((turn) => {
    const line = { ...turn, interrupted: false };
    if (turn.speaker !== 'rep') return line;
    const judged = result.turns[repTurn++]?.judged;
    return judged ? { ...line, reaction: reactionOf(judged) } : line;
  });
}

export async function reviewSimulatedCall(options: {
  messages: StreamingMessages;
  model: string;
  effort: Effort;
  prices: PriceTable;
  scenario: ScenarioSpec;
  product: ProductSpec;
  rubric: RubricSpec;
  result: SimResult;
}): Promise<{
  review: ReviewResult;
  dropped: DroppedQuote[];
  model: string;
  costUsd: number | null;
}> {
  const { scenario, product, rubric, result } = options;
  const turns = timedTurns(result, scenario.prospect.openingLine);
  const durationMs = (turns.at(-1)?.endMs ?? 0) + GAP_MS;
  const reviewer = claudeReviewer({
    messages: options.messages,
    model: options.model,
    effort: options.effort,
    prices: options.prices,
  });
  const outcome = await reviewer({
    rubric,
    scenario,
    product,
    metrics: computeMetrics(turns, durationMs),
    outcome: OUTCOMES[result.outcome],
    outcomeReason: result.detail ?? null,
    turns: reviewTurns(turns, result),
  });
  const { result: review, dropped } = finalizeReview(
    outcome.draft,
    turns,
    rubric.criteria.map((c) => c.key),
  );
  return { review, dropped, model: outcome.model, costUsd: outcome.costUsd };
}
