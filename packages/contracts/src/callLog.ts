// The agent's record of a finished call, posted to POST /internal/calls/:id/log.
// Times are milliseconds from the moment she picked up.
import { z } from 'zod';
import { CallOutcome } from './call.ts';
import { ProspectState } from './judge.ts';
import { DebugLatencyPayload } from './topics.ts';

const ms = z.int().nonnegative();

export const Speaker = z.enum(['rep', 'prospect']);
export type Speaker = z.infer<typeof Speaker>;

export const TimedWord = z.object({ text: z.string(), startMs: ms, endMs: ms });
export type TimedWord = z.infer<typeof TimedWord>;

const TurnFields = z.object({
  idx: z.int().nonnegative(),
  speaker: Speaker,
  text: z.string(),
  startMs: ms,
  endMs: ms,
  /** Rep turns only, when Deepgram returned word timings. */
  words: z.array(TimedWord).nullable(),
  /** She was talked over mid-reply (text is what was actually heard). */
  interrupted: z.boolean(),
  /** Rep turns: her state once the turn was judged. Prospect turns: the state she replied under. */
  stateAfter: ProspectState.nullable(),
});

export const LoggedTurn = TurnFields.refine((t) => t.endMs >= t.startMs, {
  message: 'endMs is before startMs',
  path: ['endMs'],
});
export type LoggedTurn = z.infer<typeof LoggedTurn>;

/** A transcript line as the web shows it: a logged turn without its word timings. */
export const CallTurn = TurnFields.omit({ words: true });
export type CallTurn = z.infer<typeof CallTurn>;

export const EventKind = z.enum([
  'judgement',
  'tool_call',
  'meeting',
  'outcome',
  'error',
  // The rep's controls (M5): the review may mention them.
  'pause',
  'resume',
  'hint',
  'rewind',
]);
export type EventKind = z.infer<typeof EventKind>;

export const LoggedEvent = z.object({
  tMs: ms,
  kind: EventKind,
  payload: z.record(z.string(), z.unknown()),
});
export type LoggedEvent = z.infer<typeof LoggedEvent>;

// Payloads of the control events the review reads back. `pause` carries none.

export const ResumeEventPayload = z.object({ pausedMs: ms });
export type ResumeEventPayload = z.infer<typeof ResumeEventPayload>;

export const HintEventPayload = z.object({
  suggestions: z.array(z.string()),
  /** How long the hint took to come back. */
  ms,
});
export type HintEventPayload = z.infer<typeof HintEventPayload>;

/** The rep took back their last turn (and her reply to it) and retook it. */
export const RewindEventPayload = z.object({
  /** The transcript turn, counting from 1, that the retake now occupies. */
  beforeTurn: z.int().positive(),
  /** The rep's words that were taken back. */
  tookBack: z.string(),
  /** Her reply to them as far as she got, or null if she hadn't started. */
  herReply: z.string().nullable(),
});
export type RewindEventPayload = z.infer<typeof RewindEventPayload>;

/** Claude usage for one lane of the call (prospect, judge, hint). */
export const LaneUsage = z.object({
  /** The model that served the calls (a fallback may differ from the one requested). */
  model: z.string(),
  calls: z.int().nonnegative(),
  inputTokens: z.int().nonnegative(),
  cacheReadInputTokens: z.int().nonnegative(),
  cacheCreationInputTokens: z.int().nonnegative(),
  outputTokens: z.int().nonnegative(),
  /** Null for a model the price table doesn't know. */
  costUsd: z.number().nonnegative().nullable(),
});
export type LaneUsage = z.infer<typeof LaneUsage>;

export const CallLog = z.object({
  outcome: CallOutcome,
  reason: z.string().optional(),
  /** Wall clock; null if she never picked up. */
  connectedAt: z.iso.datetime().nullable(),
  endedAt: z.iso.datetime(),
  /** Pick-up to hang-up; 0 if she never picked up. */
  durationMs: ms,
  turns: z
    .array(LoggedTurn)
    .refine((ts) => new Set(ts.map((t) => t.idx)).size === ts.length, 'turn idx values repeat'),
  events: z.array(LoggedEvent),
  latency: z.array(DebugLatencyPayload),
  usage: z.object({
    prospect: LaneUsage.optional(),
    judge: LaneUsage.optional(),
    /** The rep's hint requests (coached calls). */
    hint: LaneUsage.optional(),
  }),
});
export type CallLog = z.infer<typeof CallLog>;
