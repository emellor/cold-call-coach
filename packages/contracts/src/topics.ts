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

export const CoachStagePayload = z.object({
  stage: TrackerStage,
  status: z.enum(['active', 'done']),
});
export type CoachStagePayload = z.infer<typeof CoachStagePayload>;

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
