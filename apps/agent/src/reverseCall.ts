// A reverse call: the rep plays one of the prospects, and Sam, Claude as an
// expert rep, makes the call to her. The same voice pipeline as her calls
// (pipeline.ts), with Sam's agent in her place: no judge, no coach, and no
// controls but hanging up. The rep picks up and speaks first. In the log
// Sam's lines are the rep's turns and the rep's are the prospect's, so the
// call reads the right way round, and the API writes notes on his lines.
import { type CallLog, type InternalScenarioResponse, REP_IDENTITY, Topics } from '@ccc/contracts';
import { buildRepSystemPrompt } from '@ccc/core';
import { type JobContext, type VAD, voice } from '@livekit/agents';
import { CallController } from './call.ts';
import { createClaude } from './claude/client.ts';
import type { CallConfig } from './config.ts';
import { registerControls } from './controls/rpc.ts';
import { describeClaudeFailure } from './failures.ts';
import { LatencyTracker } from './latency.ts';
import { CallRecorder } from './log/recorder.ts';
import type { Logger } from './logger.ts';
import { buildSession, callNotices, describeError, watchProviders } from './pipeline.ts';
import { readPriceTable } from './prices.ts';
import { REPLY_ID_KEY, ReplyLedger } from './prospect/replies.ts';
import type { Publisher } from './publisher.ts';
import { RepAgent } from './rep/agent.ts';
import { reverseControls } from './rep/controls.ts';
import { type RepAction, actOnRepReply } from './rep/tools.ts';

/** How long Sam waits for her to say hello before he checks the line, once. */
export const NUDGE_MS = 8_000;

/** Sam's voice: REP_VOICE_ID, or the default voice the prospects fall back to. */
export const repVoice = (config: Pick<CallConfig, 'REP_VOICE_ID' | 'CARTESIA_VOICE_ID'>) =>
  config.REP_VOICE_ID ?? config.CARTESIA_VOICE_ID;

/** What Sam says when she picks up and says nothing. */
export const nudgeLine = (name: string) => `Hello? Is that ${name.split(' ')[0] ?? name}?`;

export async function runReverseCall<P>(
  ctx: JobContext<P>,
  vad: VAD,
  deps: {
    config: CallConfig;
    loaded: InternalScenarioResponse;
    logger: Logger;
    publisher: Publisher;
    /** Ends the call before it starts, with a reason the rep can read. */
    fail: (reason: string) => Promise<void>;
    /** Replaces what the job's shutdown callback posts as the call log. */
    setFinalLog: (build: () => Promise<CallLog>) => void;
  },
): Promise<void> {
  const { config, loaded, logger, publisher, fail, setFinalLog } = deps;
  const { scenario, product, rubric } = loaded;

  const voiceId = repVoice(config);
  if (!voiceId) {
    logger.error({}, 'no voice for Sam');
    return fail(
      'Sam has no voice yet: set REP_VOICE_ID (or CARTESIA_VOICE_ID) for the voice agent.',
    );
  }

  try {
    const priced = await readPriceTable();
    if (!priced.ok) {
      logger.error({ problem: priced.problem }, 'no price table: this call is unpriced');
    }
    const prices = priced.ok ? priced.prices : null;
    const recorder = new CallRecorder(Date.now, prices);
    const { notices, watchCost } = callNotices({ recorder, publisher, prices, logger });
    const claude = createClaude(config.ANTHROPIC_API_KEY, config.ANTHROPIC_WORKSPACE_ID);
    const ledger = new ReplyLedger<RepAction>();
    const agent = new RepAgent({
      system: buildRepSystemPrompt({ scenario, product, rubric }),
      claude: claude.beta.messages,
      model: config.REP_MODEL,
      effort: config.REP_EFFORT,
      ledger,
      logger,
      onUsage: (model, usage) => {
        recorder.usage('rep', model, usage, config.REP_EFFORT);
        watchCost();
      },
      onReplyFailed: (error) =>
        notices.notify({
          level: 'error',
          code: 'claude',
          message: `Sam couldn't answer: ${describeClaudeFailure(error)}`,
        }),
    });

    const session = await buildSession({
      config,
      scenario,
      product,
      vad,
      voiceId,
      speed: undefined,
    });
    const controller = new CallController({
      session,
      publisher,
      shutdown: (reason) => ctx.shutdown(reason),
      logger,
      // The rep picks up: whatever they say first is her greeting.
      openingLine: null,
      onConnected: () => recorder.connected(),
    });
    const latency = new LatencyTracker();
    let samTurns = 0;
    /** Anyone has spoken since the pick-up: then Sam doesn't check the line. */
    let spoken = false;

    setFinalLog(() => {
      const ended = controller.ended ?? {
        outcome: 'error' as const,
        reason: 'The voice agent stopped unexpectedly.',
        endedBy: 'error' as const,
        at: Date.now(),
      };
      recorder.event('outcome', { ...ended });
      return Promise.resolve(recorder.build({ ...ended, stateAfterRepTurn: () => null }));
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
        spoken = true;
        recorder.prospectTurn({ text, timing, interrupted: false, state: null });
      } else if (item.role === 'assistant') {
        spoken = true;
        samTurns += 1;
        recorder.repTurn({ text, timing, repTurn: samTurns, interrupted: item.interrupted });
        // A reply acts only once heard in full; one she cut him off in does nothing.
        const reply = ledger.committed(item.extra[REPLY_ID_KEY]);
        if (reply && !item.interrupted) {
          actOnRepReply(reply.actions, samTurns, {
            controller,
            logger,
            record: (kind, data) => recorder.event(kind, data),
          }).catch((error: unknown) =>
            logger.error({ err: error }, "acting on Sam's reply failed"),
          );
        }
      }
    });
    session.on(voice.AgentSessionEventTypes.UserStateChanged, ({ newState }) => {
      if (newState === 'speaking') spoken = true;
    });
    watchProviders(session, { recorder, notices, logger, watchCost });
    session.on(voice.AgentSessionEventTypes.Close, ({ reason, error }) => {
      // The rep hanging up closes the session: in a reverse call, that's her hanging up.
      if (error) void controller.end('error', describeError(error));
      else void controller.end('hung_up_by_prospect');
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
      if (participant) registerControls(participant, reverseControls(controller), logger);
      await ctx.waitForParticipant(REP_IDENTITY);
      await controller.ringAndPickUp();
      // She has picked up. If she says nothing, Sam checks the line, once.
      setTimeout(() => {
        if (controller.phase === 'connected' && !spoken) {
          session.say(nudgeLine(scenario.prospect.name));
        }
      }, NUDGE_MS).unref();
    } catch (error) {
      logger.error({ err: error }, 'call setup failed');
      await controller.end('error', describeError(error as object));
    }
  } catch (error) {
    // Building the pipeline failed: nothing is running, so end it here.
    logger.error({ err: error }, 'could not set up the call');
    return fail(`The voice agent couldn't set up the call: ${describeError(error as object)}`);
  }
}
