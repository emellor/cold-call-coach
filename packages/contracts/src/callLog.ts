// The agent's record of a finished call, posted to POST /internal/calls/:id/log.
// Times are milliseconds from the moment she picked up.
import { z } from 'zod';
import { CallOutcome } from './call.ts';
import { CallStage, ProspectState } from './judge.ts';
import { FactKey } from './scenario.ts';
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
  /** The agent was talked over mid-reply: her, or Sam in a reverse call (text is what was heard). */
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
  // A call.notice the rep was shown (M6): a provider failing, the cost warning.
  'notice',
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

/** Get help's answer, as the rep saw it. Calls logged before it existed carry `suggestions`. */
export const HintEventPayload = z.object({
  say: z.string(),
  why: z.string(),
  ifPushback: z.string().optional(),
  /** How long the help took to come back. */
  ms,
});
export type HintEventPayload = z.infer<typeof HintEventPayload>;

/**
 * The live judge's reading of one rep turn, and how her mood moved because of
 * it. `turn` counts rep turns from 1; a rewind reuses the number for the
 * retake, so the last event for a number is the one that stands.
 */
export const JudgementEventPayload = z.object({
  turn: z.int().positive(),
  /** False when the judge failed: nothing was read, and only the patience decay applied. */
  judged: z.boolean(),
  stage: CallStage,
  /** The names of the JudgeSignals that were on. */
  signals: z.array(z.string()),
  revealEarned: FactKey.nullable(),
  /** Before and after the turn. */
  interest: z.tuple([z.number(), z.number()]),
  patience: z.tuple([z.number(), z.number()]),
});
export type JudgementEventPayload = z.infer<typeof JudgementEventPayload>;

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
  /** The effort the lane asked for (from .env), so reports can compare settings. */
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  calls: z.int().nonnegative(),
  inputTokens: z.int().nonnegative(),
  cacheReadInputTokens: z.int().nonnegative(),
  cacheCreationInputTokens: z.int().nonnegative(),
  outputTokens: z.int().nonnegative(),
  /** Calls that read from the prompt cache: from turn 2 on, every one should (M6). */
  cachedCalls: z.int().nonnegative().optional(),
  /** Null for a model the price table doesn't know. */
  costUsd: z.number().nonnegative().nullable(),
});
export type LaneUsage = z.infer<typeof LaneUsage>;

/** Deepgram: the audio streamed for transcription, from LiveKit's STT metrics. */
export const SttUsage = z.object({
  model: z.string(),
  audioMs: z.number().nonnegative(),
  costUsd: z.number().nonnegative().nullable(),
});
export type SttUsage = z.infer<typeof SttUsage>;

/** Cartesia: the characters she spoke, from LiveKit's TTS metrics. */
export const TtsUsage = z.object({
  model: z.string(),
  characters: z.int().nonnegative(),
  costUsd: z.number().nonnegative().nullable(),
});
export type TtsUsage = z.infer<typeof TtsUsage>;

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
    /** Sam's replies, in a reverse call. */
    rep: LaneUsage.optional(),
    judge: LaneUsage.optional(),
    /** The rep's hint requests (coached calls). */
    hint: LaneUsage.optional(),
    stt: SttUsage.optional(),
    tts: TtsUsage.optional(),
  }),
});
export type CallLog = z.infer<typeof CallLog>;
