// The voice pipeline every call shares, whoever the agent plays: Deepgram
// hearing the rep, Cartesia speaking for the agent, the turn detector, and the
// call's notices and cost watch. runCall builds her calls on it, and
// reverseCall Sam's.
import type { CallNoticePayload, PriceTable, ProductSpec, ScenarioSpec } from '@ccc/contracts';
import { Topics } from '@ccc/contracts';
import { type VAD, inference, voice } from '@livekit/agents';
import * as cartesia from '@livekit/agents-plugin-cartesia';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import type { CallConfig } from './config.ts';
import { describeClaudeFailure, describeVoiceFailure } from './failures.ts';
import type { CallRecorder } from './log/recorder.ts';
import type { Logger } from './logger.ts';
import { CallNotices, CostWatch } from './notices.ts';
import type { Publisher } from './publisher.ts';
import { keytermsFor, ttsLanguage } from './scenario.ts';

/** The voice pipeline's models, named once: they're also how the call is priced. */
export const STT_MODEL = 'nova-3';
export const TTS_MODEL = 'sonic-3';
/**
 * LiveKit drafts her reply at each pause while the rep is still talking, and drops
 * the draft when they carry on; every draft is a full Claude request. Its default
 * allows three a turn, and in one measured call 25 requests became the 8 replies
 * she said. One keeps the head start on a short turn; after a long one she answers
 * once the rep has finished.
 */
export const PREEMPTIVE_GENERATION = { maxRetries: 1 };

async function turnDetection(kind: CallConfig['TURN_DETECTOR']) {
  // `audio` pins the local model so it never draws on LiveKit Cloud inference.
  if (kind === 'audio') return new inference.TurnDetector({ version: 'v1-mini' });
  const { turnDetector } = await import('@livekit/agents-plugin-livekit');
  return new turnDetector.MultilingualModel();
}

/** The session for a call: the rep heard in the scenario's locale, the agent in `voiceId`. */
export async function buildSession(options: {
  config: CallConfig;
  scenario: ScenarioSpec;
  product: ProductSpec;
  vad: VAD;
  voiceId: string;
  /** Cartesia's speed multiplier; undefined is its normal speed. */
  speed: number | undefined;
}): Promise<voice.AgentSession> {
  const { config, scenario, product, vad, voiceId, speed } = options;
  return new voice.AgentSession({
    stt: new deepgram.STT({
      apiKey: config.DEEPGRAM_API_KEY,
      model: STT_MODEL,
      language: scenario.locale,
      fillerWords: true,
      interimResults: true,
      punctuate: true,
      smartFormat: true,
      keyterm: keytermsFor(scenario, product),
    }),
    tts: new cartesia.TTS({
      apiKey: config.CARTESIA_API_KEY,
      model: TTS_MODEL,
      voice: voiceId,
      language: ttsLanguage(scenario.locale),
      speed,
    }),
    vad,
    turnHandling: {
      turnDetection: await turnDetection(config.TURN_DETECTOR),
      preemptiveGeneration: PREEMPTIVE_GENERATION,
    },
  });
}

/**
 * What the rep should know mid-call that isn't the other side talking, kept in
 * the log too, and the cost watch that sends one notice past the warning line.
 */
export function callNotices(options: {
  recorder: CallRecorder;
  publisher: Publisher;
  prices: PriceTable | null;
  logger: Logger;
}): { notices: CallNotices; watchCost: () => void } {
  const { recorder, publisher, prices, logger } = options;
  const notices = new CallNotices((notice: CallNoticePayload) => {
    recorder.event('notice', { ...notice });
    void publisher.publish(Topics.callNotice, notice);
  });
  const costWatch = new CostWatch({
    warnAboveUsd: prices?.warnAboveUsd ?? null,
    costSoFar: () => recorder.costSoFar(),
    onOver: (spent, line) => {
      logger.warn({ spentUsd: spent }, 'call cost passed the warning line');
      notices.notify({
        level: 'warn',
        code: 'cost',
        message: `This call has cost $${spent.toFixed(2)} so far, over the $${line} warning line.`,
      });
    },
  });
  return { notices, watchCost: () => costWatch.check() };
}

/** Prices what Deepgram heard and Cartesia spoke, and says so when either fails. */
export function watchProviders(
  session: voice.AgentSession,
  deps: { recorder: CallRecorder; notices: CallNotices; logger: Logger; watchCost: () => void },
): void {
  const { recorder, notices, logger, watchCost } = deps;
  // What Deepgram heard and Cartesia spoke: both are billed by the amount.
  session.on(voice.AgentSessionEventTypes.MetricsCollected, ({ metrics }) => {
    if (metrics.type === 'stt_metrics') recorder.stt(STT_MODEL, metrics.audioDurationMs);
    else if (metrics.type === 'tts_metrics') recorder.tts(TTS_MODEL, metrics.charactersCount);
    else return;
    watchCost();
  });
  // A provider that failed after LiveKit's retries: say so while the call goes on.
  // (LiveKit ends the call itself after repeated failures; see Close.)
  session.on(voice.AgentSessionEventTypes.Error, ({ error }) => {
    logger.warn({ err: error }, 'session error');
    if (error.type === 'stt_error' || error.type === 'tts_error') {
      const provider = error.type === 'stt_error' ? 'stt' : 'tts';
      notices.notify({
        level: 'error',
        code: provider,
        message: describeVoiceFailure(provider, error.error),
      });
    }
  });
}

export function describeError(error: object): string {
  const type = 'type' in error ? error.type : undefined;
  const cause = 'error' in error ? error.error : error;
  if (type === 'stt_error') return describeVoiceFailure('stt', cause);
  if (type === 'tts_error') return describeVoiceFailure('tts', cause);
  if (type === 'llm_error') return describeClaudeFailure(cause);
  return cause instanceof Error ? cause.message : 'The voice pipeline failed.';
}
