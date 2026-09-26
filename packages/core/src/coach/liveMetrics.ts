// The coach panel's numbers (PLAN.md §8.1), published about twice a second.
// Talking time and the monologue come from the live talk clock, so they move
// while someone speaks. Pace, fillers and questions need words, so they come
// from computeMetrics over the turns committed so far and move once a turn ends.
import type { CallMetrics, CoachMetricsPayload } from '@ccc/contracts';
import type { TalkSnapshot } from './talkClock.ts';

/** The committed-turn metrics the panel shows. */
export type TurnDerivedMetrics = Pick<
  CallMetrics,
  'repWpm' | 'coreFillers' | 'softFillers' | 'fillersPerMin' | 'questionsOpen' | 'questionsClosed'
>;

export const NO_TURN_METRICS: TurnDerivedMetrics = {
  repWpm: null,
  coreFillers: 0,
  softFillers: 0,
  fillersPerMin: null,
  questionsOpen: 0,
  questionsClosed: 0,
};

const tenths = (ms: number) => Math.round(ms / 100) / 10;

export function liveCoachMetrics(input: {
  /** Since she picked up. */
  elapsedMs: number;
  talk: TalkSnapshot;
  turns: TurnDerivedMetrics;
}): CoachMetricsPayload {
  const { elapsedMs, talk, turns } = input;
  const spoken = talk.repSpeechMs + talk.prospectSpeechMs;
  return {
    elapsedSec: tenths(Math.max(0, elapsedMs)),
    talkRatio: spoken > 0 ? Math.round((talk.repSpeechMs / spoken) * 100) / 100 : null,
    repWpm: turns.repWpm,
    coreFillers: turns.coreFillers,
    softFillers: turns.softFillers,
    fillersPerMin: turns.fillersPerMin,
    questionsOpen: turns.questionsOpen,
    questionsClosed: turns.questionsClosed,
    currentMonologueSec: tenths(talk.currentMonologueMs),
    longestMonologueSec: tenths(talk.longestMonologueMs),
  };
}
