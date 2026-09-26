import {
  type CallLog,
  DispatchMetadata,
  type InternalScenarioResponse,
  REP_IDENTITY,
  Topics,
} from '@ccc/contracts';
import { buildHintSystemPrompt, buildHintUserPrompt, buildProspectSystemPrompt } from '@ccc/core';
import { type JobContext, type VAD, inference, log, voice } from '@livekit/agents';
import * as cartesia from '@livekit/agents-plugin-cartesia';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import { CallController } from './call.ts';
import { chatContextToTurns, repSpeakingSeconds } from './chat.ts';
import { createClaude } from './claude/client.ts';
import { type CallConfig, readCallConfig } from './config.ts';
import { claudeHints } from './coach/hint.ts';
import { LiveCoach } from './coach/liveCoach.ts';
import { CallControls } from './controls/controls.ts';
import { registerControls } from './controls/rpc.ts';
import { claudeJudge } from './judge/judge.ts';
import { LatencyTracker } from './latency.ts';
import { postCallLog } from './log/post.ts';
import { CallRecorder } from './log/recorder.ts';
import type { Logger } from './logger.ts';
import { actOnReply } from './prospect/actions.ts';
import { ProspectAgent } from './prospect/agent.ts';
import { ProspectBrain } from './prospect/brain.ts';
import { REPLY_ID_KEY, ReplyLedger } from './prospect/replies.ts';
import { Publisher } from './publisher.ts';
import { cartesiaSpeed, chooseVoice, fetchScenario, keytermsFor, ttsLanguage } from './scenario.ts';

/** How long to wait for the rep before giving up on telling them anything. */
const REP_WAIT_MS = 10_000;
/** How long the call log waits for judgements still running when the call ends. */
const JUDGE_SETTLE_MS = 5_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function parseDispatchMetadata(text: string): DispatchMetadata | null {
  try {
    const parsed = DispatchMetadata.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function turnDetection(kind: CallConfig['TURN_DETECTOR']) {
  // `audio` pins the local model so it never draws on LiveKit Cloud inference.
  if (kind === 'audio') return new inference.TurnDetector({ version: 'v1-mini' });
  const { turnDetector } = await import('@livekit/agents-plugin-livekit');
  return new turnDetector.MultilingualModel();
}

/** One job = one call. */
export async function runCall<P>(ctx: JobContext<P>, vad: VAD): Promise<void> {
  const logger: Logger = log().child({ room: ctx.job.room?.name });
  const publisher = new Publisher(ctx.room, logger);

  const meta = parseDispatchMetadata(ctx.job.metadata);
  if (!meta) {
    logger.error({ metadata: ctx.job.metadata }, 'invalid dispatch metadata');
    return failCall(ctx, publisher, 'The call was dispatched without valid call details.');
  }
  logger.info({ ...meta }, 'call dispatched');

  const configResult = readCallConfig(process.env);
  if (!configResult.ok) {
    logger.error({ problems: configResult.problems }, 'agent is missing configuration');
    return failCall(
      ctx,
      publisher,
      `The voice agent is not configured: ${configResult.problems.join('; ')}.`,
    );
  }
  const config = configResult.config;
  const postLog = (log: CallLog) =>
    postCallLog({
      apiBaseUrl: config.API_BASE_URL,
      secret: config.INTERNAL_API_SECRET,
      callId: meta.callId,
      log,
      logger,
    });

  let loaded: InternalScenarioResponse;
  try {
    loaded = await fetchScenario({
      apiBaseUrl: config.API_BASE_URL,
      secret: config.INTERNAL_API_SECRET,
      scenarioId: meta.scenarioId,
    });
  } catch (error) {
    logger.error({ err: error }, 'could not load the scenario');
    const detail = error instanceof Error ? error.message : String(error);
    return failCall(
      ctx,
      publisher,
      `The voice agent couldn't load the scenario: ${detail}.`,
      postLog,
    );
  }
  const { scenario, product } = loaded;

  const voiceChoice = chooseVoice(scenario, config.CARTESIA_VOICE_ID);
  if (!voiceChoice.ok) {
    logger.error({ scenarioId: scenario.id }, voiceChoice.problem);
    return failCall(ctx, publisher, `${voiceChoice.problem}.`, postLog);
  }

  const recorder = new CallRecorder();
  const claude = createClaude(config.ANTHROPIC_API_KEY);
  // The live coach (coached calls only): metrics, the stage tracker and tips.
  const coach = new LiveCoach({
    mode: meta.mode,
    publisher,
    stages: () => brain.stages,
    repStopLagMs: vad.minSilenceDuration ?? 0,
  });
  const brain = new ProspectBrain({
    scenario,
    product,
    judge: claudeJudge({
      messages: claude.beta.messages,
      model: config.COACH_MODEL,
      effort: config.COACH_EFFORT,
      logger,
      onUsage: (model, usage) => recorder.usage('judge', model, usage),
    }),
    logger,
    onState: (payload) => void publisher.publish(Topics.prospectState, payload),
    onJudged: ({ turn, judged, judge, before, after }) => {
      recorder.event('judgement', {
        turn,
        judged,
        stage: judge.stage,
        signals: Object.entries(judge.signals)
          .filter(([, on]) => on)
          .map(([name]) => name),
        revealEarned: judge.revealEarned,
        tip: judge.tip,
        interest: [before.interest, after.interest],
        patience: [before.patience, after.patience],
      });
      coach.judged(turn, judge);
    },
  });
  const ledger = new ReplyLedger();
  const agent = new ProspectAgent({
    persona: buildProspectSystemPrompt(scenario),
    claude: claude.beta.messages,
    model: config.PROSPECT_MODEL,
    effort: config.PROSPECT_EFFORT,
    brain,
    ledger,
    logger,
    onUsage: (model, usage) => recorder.usage('prospect', model, usage),
    onSttFinal: (words) => recorder.sttFinal(words),
    paused: (): boolean => controls.paused,
  });

  const session = new voice.AgentSession({
    stt: new deepgram.STT({
      apiKey: config.DEEPGRAM_API_KEY,
      model: 'nova-3',
      language: scenario.locale,
      fillerWords: true,
      interimResults: true,
      punctuate: true,
      smartFormat: true,
      keyterm: keytermsFor(scenario, product),
    }),
    tts: new cartesia.TTS({
      apiKey: config.CARTESIA_API_KEY,
      model: 'sonic-3',
      voice: voiceChoice.voiceId,
      language: ttsLanguage(scenario.locale),
      speed: cartesiaSpeed(scenario.voice.speed),
    }),
    vad,
    turnHandling: { turnDetection: await turnDetection(config.TURN_DETECTOR) },
  });

  const controller = new CallController({
    session,
    publisher,
    shutdown: (reason) => ctx.shutdown(reason),
    logger,
    openingLine: scenario.prospect.openingLine,
    onConnected: () => {
      recorder.connected();
      coach.connected();
    },
    onEnded: () => coach.ended(),
  });

  const latency = new LatencyTracker();
  const hintSystem = buildHintSystemPrompt(scenario, product);
  const controls = new CallControls({
    mode: meta.mode,
    session,
    agent,
    brain,
    recorder,
    coach,
    controller,
    hints: claudeHints({
      messages: claude.beta.messages,
      model: config.COACH_MODEL,
      effort: config.COACH_EFFORT,
      logger,
      onUsage: (model, usage) => recorder.usage('hint', model, usage),
    }),
    hintPrompt: () => ({
      system: hintSystem,
      user: buildHintUserPrompt(chatContextToTurns(agent.chatCtx)),
    }),
    latency,
    logger,
  });

  // Whatever ends the call (her, the rep, the time limit, a crash), the log
  // goes to the API once the job shuts down; the API reviews it from there.
  ctx.addShutdownCallback(async () => {
    await Promise.race([brain.settled(), sleep(JUDGE_SETTLE_MS)]);
    const ended = controller.ended ?? {
      outcome: 'error' as const,
      reason: 'The voice agent stopped unexpectedly.',
      endedBy: 'error' as const,
      at: Date.now(),
    };
    recorder.event('outcome', { ...ended });
    await postLog(
      recorder.build({
        ...ended,
        stateAfterRepTurn: (n) => brain.history.find((t) => t.turn === n)?.after ?? null,
      }),
    );
  });

  session.on(voice.AgentSessionEventTypes.ConversationItemAdded, ({ item }) => {
    const payload = latency.onItem(item);
    if (payload) {
      recorder.latency(payload);
      void publisher.publish(Topics.debugLatency, payload);
    }
    if (item.type !== 'message') return;
    const text = item.textContent ?? '';
    const timing = {
      startedSpeakingAt: item.metrics.startedSpeakingAt,
      stoppedSpeakingAt: item.metrics.stoppedSpeakingAt,
      committedAt: Date.now(),
    };

    if (item.role === 'user') {
      // Judged beside her reply, never before it: the result shapes her next one.
      const repTurn = brain.repTurn(chatContextToTurns(agent.chatCtx), {
        longestMonologueSec: repSpeakingSeconds(item.metrics),
      });
      recorder.repTurn({ text, timing, repTurn });
      coach.turnsChanged(recorder.metricTurns());
    } else if (item.role === 'assistant') {
      recorder.prospectTurn({ text, timing, interrupted: item.interrupted, state: brain.state });
      coach.turnsChanged(recorder.metricTurns());
      // A reply acts only once heard in full; one she was cut off in does nothing.
      const reply = ledger.committed(item.extra[REPLY_ID_KEY]);
      if (reply && !item.interrupted) {
        actOnReply(reply, brain.repTurns, {
          brain,
          controller: {
            recordMeeting: async (when) => {
              await controller.recordMeeting(when);
              coach.meetingBooked();
            },
            end: (outcome, reason) => controller.end(outcome, reason),
          },
          logger,
          record: (kind, data) => recorder.event(kind, data),
        }).catch((error: unknown) => logger.error({ err: error }, 'acting on her reply failed'));
      }
    }
  });
  // Who is speaking, live: the coach's talk clock and monologue timer.
  session.on(voice.AgentSessionEventTypes.UserStateChanged, ({ newState, createdAt }) =>
    coach.userState(newState, createdAt),
  );
  session.on(voice.AgentSessionEventTypes.AgentStateChanged, ({ newState, createdAt }) =>
    coach.agentState(newState, createdAt),
  );
  session.on(voice.AgentSessionEventTypes.Error, ({ error }) => {
    logger.warn({ err: error }, 'session error');
  });
  session.on(voice.AgentSessionEventTypes.Close, ({ reason, error }) => {
    // The rep hanging up closes the session (the room input closes on disconnect).
    if (error) void controller.end('error', describeError(error));
    else void controller.end('ended_by_rep');
    logger.info({ reason }, 'session closed');
  });

  try {
    await session.start({
      agent,
      room: ctx.room,
      inputOptions: { participantIdentity: REP_IDENTITY },
    });
    await ctx.connect();
    const participant = ctx.room.localParticipant;
    if (participant) registerControls(participant, controls, logger);
    await ctx.waitForParticipant(REP_IDENTITY);
    await controller.ringAndPickUp();
    if (controller.phase === 'connected') {
      await publisher.publish(Topics.prospectState, brain.statePayload());
    }
  } catch (error) {
    logger.error({ err: error }, 'call setup failed');
    await controller.end('error', describeError(error as object));
  }
}

function describeError(error: object): string {
  const cause = 'error' in error ? error.error : error;
  return cause instanceof Error ? cause.message : 'The voice pipeline failed.';
}

/**
 * Tells the rep why the call cannot go ahead, then ends the job. With a way to
 * reach the API, the call is logged as failed too, so history shows why.
 */
async function failCall<P>(
  ctx: JobContext<P>,
  publisher: Publisher,
  reason: string,
  postLog?: (log: CallLog) => Promise<boolean>,
): Promise<void> {
  if (postLog) {
    ctx.addShutdownCallback(async () => {
      const at = new Date().toISOString();
      await postLog({
        outcome: 'error',
        reason,
        connectedAt: null,
        endedAt: at,
        durationMs: 0,
        turns: [],
        events: [{ tMs: 0, kind: 'error', payload: { reason } }],
        latency: [],
        usage: {},
      });
    });
  }
  try {
    await ctx.connect();
    await Promise.race([
      ctx.waitForParticipant(REP_IDENTITY),
      new Promise((resolve) => setTimeout(resolve, REP_WAIT_MS)),
    ]);
    await publisher.publish(Topics.callState, { phase: 'ended', outcome: 'error', reason });
  } finally {
    ctx.shutdown('error');
  }
}
