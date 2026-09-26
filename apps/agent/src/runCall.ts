import Anthropic from '@anthropic-ai/sdk';
import { DispatchMetadata, REP_IDENTITY, Topics } from '@ccc/contracts';
import { type JobContext, type VAD, inference, log, voice } from '@livekit/agents';
import * as cartesia from '@livekit/agents-plugin-cartesia';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import { CallController } from './call.ts';
import { type CallConfig, readCallConfig } from './config.ts';
import { LatencyTracker } from './latency.ts';
import type { Logger } from './log.ts';
import { ProspectAgent } from './prospect/agent.ts';
import { CLAIRE } from './prospect/claire.ts';
import { Publisher } from './publisher.ts';

/** How long to wait for the rep before giving up on telling them anything. */
const REP_WAIT_MS = 10_000;

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

  const claude = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  const agent = new ProspectAgent({
    persona: CLAIRE.persona,
    claude: claude.beta.messages,
    model: config.PROSPECT_MODEL,
    effort: config.PROSPECT_EFFORT,
    logger,
  });

  const session = new voice.AgentSession({
    stt: new deepgram.STT({
      apiKey: config.DEEPGRAM_API_KEY,
      model: 'nova-3',
      language: 'en-GB',
      fillerWords: true,
      interimResults: true,
      punctuate: true,
      smartFormat: true,
      keyterm: [...CLAIRE.keyterms],
    }),
    tts: new cartesia.TTS({
      apiKey: config.CARTESIA_API_KEY,
      model: 'sonic-3',
      voice: config.CARTESIA_VOICE_ID,
    }),
    vad,
    turnHandling: { turnDetection: await turnDetection(config.TURN_DETECTOR) },
  });

  const controller = new CallController({
    session,
    publisher,
    shutdown: (reason) => ctx.shutdown(reason),
    logger,
    openingLine: CLAIRE.openingLine,
  });

  const latency = new LatencyTracker();
  session.on(voice.AgentSessionEventTypes.ConversationItemAdded, ({ item }) => {
    const payload = latency.onItem(item);
    if (payload) void publisher.publish(Topics.debugLatency, payload);
  });
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
    await ctx.waitForParticipant(REP_IDENTITY);
    await controller.ringAndPickUp();
  } catch (error) {
    logger.error({ err: error }, 'call setup failed');
    await controller.end('error', describeError(error as object));
  }
}

function describeError(error: object): string {
  const cause = 'error' in error ? error.error : error;
  return cause instanceof Error ? cause.message : 'The voice pipeline failed.';
}

/** Tells the rep why the call cannot go ahead, then ends the job. */
async function failCall<P>(
  ctx: JobContext<P>,
  publisher: Publisher,
  reason: string,
): Promise<void> {
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
