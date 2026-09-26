// LiveKit text-stream topics, agent → web (PLAN.md §9). The agent sends each
// payload with `localParticipant.sendText(JSON.stringify(payload), { topic })`;
// both ends validate it against the schema registered here.
import { z } from 'zod';
import { CallOutcome, CallPhase } from './call.ts';
import { Mood } from './judge.ts';

export const CallStatePayload = z.object({
  phase: CallPhase,
  outcome: CallOutcome.optional(),
  reason: z.string().optional(),
});
export type CallStatePayload = z.infer<typeof CallStatePayload>;

const Millis = z.number().int().nonnegative().nullable();

/**
 * One prospect reply's latency, in milliseconds, from LiveKit's ChatMessage
 * metrics. Null when a stage did not happen: the opening line has no LLM, for
 * example, and a reply cut off before playout has no end-to-end time.
 */
export const DebugLatencyPayload = z.object({
  turn: z.number().int().nonnegative(),
  endOfTurnMs: Millis,
  llmTtftMs: Millis,
  ttsTtfbMs: Millis,
  e2eMs: Millis,
});
export type DebugLatencyPayload = z.infer<typeof DebugLatencyPayload>;

/** The prospect's mood and hidden state after each judged turn. */
export const ProspectStatePayload = z.object({
  turn: z.int().nonnegative(),
  mood: Mood,
  interest: z.number().min(0).max(100),
  patience: z.number().min(0).max(100),
});
export type ProspectStatePayload = z.infer<typeof ProspectStatePayload>;

/** The live stage tracker: Opener → Reason → Discovery → Objections → Next step. */
export const TrackerStage = z.enum(['opener', 'reason', 'discovery', 'objections', 'next_step']);
export type TrackerStage = z.infer<typeof TrackerStage>;

/** `pending` resets a stage, after a rewind takes back the turn that reached it. */
export const StageStatus = z.enum(['pending', 'active', 'done']);
export type StageStatus = z.infer<typeof StageStatus>;

export const CoachStagePayload = z.object({ stage: TrackerStage, status: StageStatus });
export type CoachStagePayload = z.infer<typeof CoachStagePayload>;

/** The live coach panel's numbers (PLAN.md §8.1), about twice a second in coached calls. */
export const CoachMetricsPayload = z.object({
  elapsedSec: z.number().nonnegative(),
  /** Rep share of speaking time so far, 0–1; null before anyone has spoken. */
  talkRatio: z.number().min(0).max(1).nullable(),
  repWpm: z.number().nonnegative().nullable(),
  coreFillers: z.int().nonnegative(),
  softFillers: z.int().nonnegative(),
  fillersPerMin: z.number().nonnegative().nullable(),
  questionsOpen: z.int().nonnegative(),
  questionsClosed: z.int().nonnegative(),
  /** The monologue under way now; 0 once the rep has stopped or she has spoken. */
  currentMonologueSec: z.number().nonnegative(),
  longestMonologueSec: z.number().nonnegative(),
});
export type CoachMetricsPayload = z.infer<typeof CoachMetricsPayload>;

/** A live coaching tip from the judge (coached calls only; at most one every 20 s). */
export const CoachTipPayload = z.object({
  id: z.string().min(1),
  turn: z.int().positive(),
  severity: z.enum(['info', 'warn']),
  text: z.string().min(1),
});
export type CoachTipPayload = z.infer<typeof CoachTipPayload>;

/**
 * Something the rep should know mid-call that isn't her talking: a provider
 * failing, the cost passing the warning line. A newer notice with the same
 * code replaces the older one.
 */
export const CallNoticePayload = z.object({
  level: z.enum(['info', 'warn', 'error']),
  code: z.enum(['cost', 'claude', 'stt', 'tts', 'agent']),
  message: z.string().min(1),
});
export type CallNoticePayload = z.infer<typeof CallNoticePayload>;

export interface Topic<S extends z.ZodType> {
  readonly name: string;
  readonly schema: S;
}

const topic = <S extends z.ZodType>(name: string, schema: S): Topic<S> => ({ name, schema });

export const Topics = {
  callState: topic('call.state', CallStatePayload),
  debugLatency: topic('debug.latency', DebugLatencyPayload),
  prospectState: topic('prospect.state', ProspectStatePayload),
  coachStage: topic('coach.stage', CoachStagePayload),
  coachMetrics: topic('coach.metrics', CoachMetricsPayload),
  coachTip: topic('coach.tip', CoachTipPayload),
  callNotice: topic('call.notice', CallNoticePayload),
} as const;

/** LiveKit's built-in transcription topic, read on the web with `useTranscriptions`. */
export const TRANSCRIPTION_TOPIC = 'lk.transcription';

/** Parses a received text-stream message, or returns null if it is not valid JSON for the topic. */
export function parseTopicMessage<S extends z.ZodType>(
  topic: Topic<S>,
  text: string,
): z.infer<S> | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = topic.schema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
