// Delivery metrics (PLAN.md §8.1). Code computes them (packages/core/metrics);
// the review is told them as facts and never recounts.
import { z } from 'zod';

const seconds = z.number().nonnegative();

export const CallMetrics = z.object({
  /** Connect to hang-up. */
  durationSec: seconds,
  repSpeechSec: seconds,
  prospectSpeechSec: seconds,
  /** Rep speech ÷ (rep + prospect speech), 0–1; null before anyone has spoken. */
  talkRatio: z.number().min(0).max(1).nullable(),
  repWords: z.int().nonnegative(),
  /** Rep words per minute of rep speech; null before the rep has spoken. */
  repWpm: z.number().nonnegative().nullable(),
  /** um, uh, erm, er, ah. */
  coreFillers: z.int().nonnegative(),
  /** like, you know, basically, sort of, kind of, literally, I mean (noisy; reported apart). */
  softFillers: z.int().nonnegative(),
  /** Core fillers per minute of rep speech; null before the rep has spoken. */
  fillersPerMin: z.number().nonnegative().nullable(),
  questionsOpen: z.int().nonnegative(),
  questionsClosed: z.int().nonnegative(),
  /** Continuous rep speech, gaps under 1.5 s merged unless she spoke in between. */
  longestMonologueSec: seconds,
  /** Times the rep talked over her. */
  interruptions: z.int().nonnegative(),
  /** Connect to the rep's first question; null if they never asked one. */
  timeToFirstQuestionSec: seconds.nullable(),
});
export type CallMetrics = z.infer<typeof CallMetrics>;

/** The §8.1 starting targets, shown against each metric and given to the review. */
export const METRIC_TARGETS = {
  talkRatio: { min: 0.4, max: 0.6 },
  repWpm: { min: 130, max: 170 },
  fillersPerMin: { max: 2 },
  longestMonologueSec: { max: 45, warnAt: 30 },
} as const;
