// The judge scores each rep turn (PLAN.md §6.3). Its output is parsed with
// structured outputs, so this schema is also what Claude is constrained to.
import { z } from 'zod';
import { FactKey } from './scenario.ts';

export const CallStage = z.enum([
  'opener',
  'reason',
  'discovery',
  'pitch',
  'objection_handling',
  'close',
  'other',
]);
export type CallStage = z.infer<typeof CallStage>;

const signal = (meaning: string) => z.boolean().describe(meaning);

export const JudgeSignals = z.object({
  askedPermission: signal('Asked for a moment of her time, e.g. "have you got 30 seconds?"'),
  gaveRelevantReason: signal('Gave a reason to talk that a person in her role would recognise'),
  askedOpenQuestion: signal('Asked an open question (what, how, why, tell me, walk me through)'),
  followedUp: signal('Followed up on something she just said rather than moving on'),
  acknowledgedObjection: signal('Acknowledged her objection before responding to it'),
  pitchedFeatures: signal('Listed product features instead of connecting to her situation'),
  ignoredHerPoint: signal('Ignored or talked past what she just said'),
  pushy: signal('Pushed after a clear no, or pressured her'),
  rude: signal('Was rude, insulting or dismissive'),
  askedForMeeting: signal('Asked for a meeting or call'),
  proposedSpecificTime: signal('Proposed a specific day and time'),
});
export type JudgeSignals = z.infer<typeof JudgeSignals>;

export const TipSeverity = z.enum(['info', 'warn']);
export type TipSeverity = z.infer<typeof TipSeverity>;

export const JudgeResult = z.object({
  stage: CallStage.describe('The stage of the call this rep turn belongs to'),
  signals: JudgeSignals,
  revealEarned: FactKey.nullable().describe(
    'The key of the one private fact this turn earned with a relevant, well-aimed question, or null',
  ),
  tip: z
    .object({
      severity: TipSeverity,
      text: z.string().describe('At most 15 words, addressed to the rep'),
    })
    .nullable()
    .describe('A coaching tip for the rep right now, or null if nothing is worth saying'),
});
export type JudgeResult = z.infer<typeof JudgeResult>;

export const Mood = z.enum(['neutral', 'happy', 'angry']);
export type Mood = z.infer<typeof Mood>;

/** The prospect's hidden state; the rep never sees it during a call. */
export const ProspectState = z.object({
  /** Rep turns judged so far. */
  turn: z.int().nonnegative(),
  interest: z.number().min(0).max(100),
  patience: z.number().min(0).max(100),
  /** The private facts she may now discuss (PLAN.md keeps the name for every fact kind). */
  painsRevealed: z.array(FactKey),
});
export type ProspectState = z.infer<typeof ProspectState>;
