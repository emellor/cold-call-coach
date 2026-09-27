// Every quote in a review must be words the call actually contains (PLAN.md
// §8.4): evidence quotes, the walkthrough's moments (the rep's words, or hers
// for a missed opportunity) and "your response". Comparison ignores
// whitespace, case and punctuation; an ellipsis may join fragments of one
// turn in order. A quote pinned to the wrong turn moves to the turn that has
// it; one found nowhere is dropped with its item.
import {
  MAX_MOMENTS,
  type ReviewDraft,
  type ReviewResult,
  type RubricCriterionKey,
  type Speaker,
} from '@ccc/contracts';

export interface QuoteTurn {
  speaker: Speaker;
  text: string;
}

export interface DroppedQuote {
  /** Where in the review it was, e.g. "stages.discovery.evidence" or "moments". */
  field: string;
  turn: number;
  quote: string;
}

/** Lower-case, no punctuation or apostrophes, single spaces. */
export const normalizeForQuote = (text: string): string =>
  text
    .toLowerCase()
    .replace(/['’‘`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

function contains(turnText: string, quote: string): boolean {
  const haystack = normalizeForQuote(turnText);
  const parts = quote
    .split(/\.\.\.|…/)
    .map(normalizeForQuote)
    .filter(Boolean);
  if (!parts.length) return false;
  let from = 0;
  for (const part of parts) {
    // Whole words only: "at" must not match inside "that".
    const at = ` ${haystack} `.indexOf(` ${part} `, from);
    if (at === -1) return false;
    from = at + part.length;
  }
  return true;
}

/**
 * The 1-based turn that contains `quote`: the cited turn if it does, otherwise
 * the matching turn nearest to it. Null if no turn (of `speaker`, if given) has it.
 */
export function findQuote(
  turns: readonly QuoteTurn[],
  quote: string,
  citedTurn: number,
  speaker?: Speaker,
): number | null {
  const fits = (i: number) => {
    const turn = turns[i];
    return (
      turn !== undefined && (!speaker || turn.speaker === speaker) && contains(turn.text, quote)
    );
  };
  if (Number.isInteger(citedTurn) && fits(citedTurn - 1)) return citedTurn;
  let best: number | null = null;
  for (let i = 0; i < turns.length; i++) {
    if (fits(i) && (best === null || Math.abs(i + 1 - citedTurn) < Math.abs(best - citedTurn))) {
      best = i + 1;
    }
  }
  return best;
}

/** The draft with every unverifiable quote's item removed, and the turn numbers corrected. */
export function validateQuotes(
  draft: ReviewDraft,
  turns: readonly QuoteTurn[],
): { review: ReviewDraft; dropped: DroppedQuote[] } {
  const dropped: DroppedQuote[] = [];
  const locate = (field: string, turn: number, quote: string, speaker?: Speaker) => {
    const found = findQuote(turns, quote, turn, speaker);
    if (found === null) dropped.push({ field, turn, quote });
    return found;
  };

  const stages = draft.stages.map((stage) => ({
    ...stage,
    evidence: stage.evidence.flatMap((e) => {
      const turn = locate(`stages.${stage.key}.evidence`, e.turn, e.quote);
      return turn === null ? [] : [{ ...e, turn }];
    }),
  }));
  const moments = draft.moments.flatMap((m) => {
    const turn = locate('moments', m.turn, m.quote, m.kind === 'missed' ? 'prospect' : 'rep');
    return turn === null ? [] : [{ ...m, turn }];
  });
  const objections = draft.objections.flatMap((o) => {
    const turn = locate('objections', o.turn, o.yourResponse, 'rep');
    return turn === null ? [] : [{ ...o, turn }];
  });
  return { review: { ...draft, stages, moments, objections }, dropped };
}

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(Number.isFinite(n) ? n : min)));

const trimmed = (lines: readonly string[], max: number) =>
  lines
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, max);

/**
 * The stored review: quotes validated, scores rounded into range, one stage
 * per rubric criterion in rubric order, the walkthrough in turn order, and at
 * most three strengths and priorities.
 */
export function finalizeReview(
  draft: ReviewDraft,
  turns: readonly QuoteTurn[],
  criteria: readonly RubricCriterionKey[],
): { result: ReviewResult; dropped: DroppedQuote[] } {
  const { review, dropped } = validateQuotes(draft, turns);
  const stages = criteria.flatMap((key) => {
    const stage = review.stages.find((s) => s.key === key);
    return stage
      ? [
          {
            key,
            score: clamp(stage.score, 1, 5),
            evidence: stage.evidence.map((e) => ({ turn: e.turn, quote: e.quote.trim() })),
            feedback: stage.feedback.trim(),
            nextTime: stage.nextTime.trim(),
          },
        ]
      : [];
  });
  return {
    dropped,
    result: {
      outcome: review.outcome.trim(),
      overallScore: clamp(review.overallScore, 0, 100),
      summary: review.summary.trim(),
      stages,
      // A stable sort: moments on one turn keep the order Claude gave them.
      moments: review.moments
        .map((m) => ({
          turn: m.turn,
          kind: m.kind,
          stage: m.stage,
          quote: m.quote.trim(),
          whatHappened: m.whatHappened.trim(),
          sayInstead: m.kind === 'strong' ? '' : m.sayInstead.trim(),
          why: m.why.trim(),
        }))
        .sort((a, b) => a.turn - b.turn)
        .slice(0, MAX_MOMENTS),
      objections: review.objections.map((o) => ({
        turn: o.turn,
        objection: o.objection.trim(),
        yourResponse: o.yourResponse.trim(),
        score: clamp(o.score, 1, 5),
        better: o.better.trim(),
      })),
      strengths: trimmed(review.strengths, 3),
      priorities: trimmed(review.priorities, 3),
      drill: { title: review.drill.title.trim(), instructions: review.drill.instructions.trim() },
      quotesDropped: dropped.length,
    },
  };
}
