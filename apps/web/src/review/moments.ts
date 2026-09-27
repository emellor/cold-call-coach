import type { MomentKind, ReviewResult, RubricCriterionKey } from '@ccc/contracts';

/** A walkthrough moment as the page shows it. An older review's top moments have no stage. */
export interface ShownMoment {
  turn: number;
  kind: MomentKind;
  stage?: RubricCriterionKey;
  quote: string;
  whatHappened: string;
  sayInstead: string;
  why: string;
}

/**
 * The walkthrough in turn order. A review stored before it had three top
 * moments instead: each was something to change, so they show as mistakes.
 */
export function walkthrough(result: ReviewResult): ShownMoment[] {
  if (result.moments) return result.moments;
  return (result.topMoments ?? [])
    .map((m) => ({
      turn: m.turn,
      kind: 'mistake' as const,
      quote: m.youSaid,
      whatHappened: '',
      sayInstead: m.tryInstead,
      why: m.why,
    }))
    .sort((a, b) => a.turn - b.turn);
}

export const MOMENT_LABELS: Record<MomentKind, string> = {
  strong: 'Worked',
  mistake: 'Went wrong',
  missed: 'Missed chance',
};

const COUNTED: Record<MomentKind, [one: string, many: string]> = {
  mistake: ['mistake', 'mistakes'],
  missed: ['missed chance', 'missed chances'],
  strong: ['strong moment', 'strong moments'],
};

/** "2 mistakes · 1 missed chance · 1 strong moment", leaving out the kinds with none. */
export function tally(moments: readonly ShownMoment[]): string {
  return (['mistake', 'missed', 'strong'] as const)
    .map((kind) => {
      const n = moments.filter((m) => m.kind === kind).length;
      return n ? `${n} ${COUNTED[kind][n === 1 ? 0 : 1]}` : '';
    })
    .filter(Boolean)
    .join(' · ');
}
