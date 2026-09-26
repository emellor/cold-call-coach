import type { ReadableStream } from 'node:stream/web';
import { TransformStream } from 'node:stream/web';
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import {
  type Effort,
  type TokenUsage,
  buildProspectMessages,
  modelCapabilities,
  withStateNote,
} from '@ccc/core';
import { llm, stt, voice } from '@livekit/agents';
import type { AudioFrame } from '@livekit/rtc-node';
import { chatContextToTurns } from '../chat.ts';
import { prospectRequest } from '../claude/requests.ts';
import { usageOf } from '../judge/judge.ts';
import type { SttWord } from '../log/recorder.ts';
import { type StreamingMessages, claudeTextStream } from '../claude/textStream.ts';
import type { Logger } from '../logger.ts';
import { REPLY_ID_KEY, type ReplyLedger } from './replies.ts';
import { type ProspectAction, actionsFromMessage, closingLine } from './tools.ts';

/**
 * LiveKit only runs an agent's `llmNode` when an `LLM` instance is configured
 * (with none, user turns get no reply). The prospect calls Claude itself from
 * `llmNode`, so this stands in and is never asked to chat.
 */
export class DirectClaudeLLM extends llm.LLM {
  readonly #model: string;

  constructor(model: string) {
    super();
    this.#model = model;
  }

  label(): string {
    return 'anthropic.direct';
  }

  override get model(): string {
    return this.#model;
  }

  override get provider(): string {
    return 'anthropic';
  }

  chat(): llm.LLMStream {
    throw new Error(
      'DirectClaudeLLM is a placeholder: ProspectAgent.llmNode calls Claude directly.',
    );
  }
}

export interface ProspectAgentOptions {
  /** buildProspectSystemPrompt(scenario): fixed for the call, so it caches. */
  persona: string;
  claude: StreamingMessages;
  model: string;
  effort: Effort;
  /** Her hidden state, read (never awaited) when each reply starts. */
  brain: { note(): string; readonly hangUpDue: boolean };
  ledger: ReplyLedger;
  logger: Logger;
  /** Every finished reply's usage, by the model that answered. */
  onUsage?: (model: string, usage: TokenUsage) => void;
  /** Each final transcript's words, as Deepgram timed them. */
  onSttFinal?: (words: SttWord[]) => void;
  /** True while the rep has the call paused: whatever LiveKit hears is not a turn. */
  paused?: () => boolean;
}

/** Leads the reply with its id in `extra`, which LiveKit copies onto the committed message. */
function tagWithReplyId(id: string, text: ReadableStream<string>) {
  return text.pipeThrough(
    new TransformStream<string, llm.ChatChunk | string>({
      start(controller) {
        controller.enqueue({ id, delta: { role: 'assistant', extra: { [REPLY_ID_KEY]: id } } });
      },
    }),
  );
}

/** Passes STT events through untouched, handing each final transcript's word timings to `onFinal`. */
export function tapFinalWords(
  events: ReadableStream<stt.SpeechEvent | string>,
  onFinal: (words: SttWord[]) => void,
): ReadableStream<stt.SpeechEvent | string> {
  return events.pipeThrough(
    new TransformStream<stt.SpeechEvent | string, stt.SpeechEvent | string>({
      transform(event, controller) {
        if (typeof event !== 'string' && event.type === stt.SpeechEventType.FINAL_TRANSCRIPT) {
          const words = event.alternatives?.[0]?.words ?? [];
          onFinal(words.map((w) => ({ text: w.text, startTime: w.startTime, endTime: w.endTime })));
        }
        controller.enqueue(event);
      },
    }),
  );
}

/**
 * The prospect. Its `llmNode` rebuilds the Claude conversation from LiveKit's
 * chat context every turn, adds her private state note, and streams the reply
 * straight into TTS. Nothing else is awaited on this path (PLAN.md §15): the
 * note is whatever the judge had settled by the time the reply started.
 */
export class ProspectAgent extends voice.Agent {
  readonly #options: ProspectAgentOptions;

  constructor(options: ProspectAgentOptions) {
    super({ instructions: options.persona, llm: new DirectClaudeLLM(options.model) });
    this.#options = options;
  }

  /**
   * The default STT node, with each final transcript's word timings copied
   * aside for the call log (PLAN.md §8.1: pace, monologues).
   */
  override async sttNode(
    audio: ReadableStream<AudioFrame> | AsyncIterable<AudioFrame>,
    modelSettings: voice.ModelSettings,
  ): Promise<ReadableStream<stt.SpeechEvent | string> | null> {
    const events = await voice.Agent.default.sttNode(this, audio, modelSettings);
    const onFinal = this.#options.onSttFinal;
    return events && onFinal ? tapFinalWords(events, onFinal) : events;
  }

  /**
   * While paused the agent ignores turns (PLAN.md §8.3): a turn that completes
   * anyway, from speech already under way when the rep paused, is dropped
   * before it reaches the conversation, so she neither hears nor answers it.
   */
  override onUserTurnCompleted(_chatCtx: llm.ChatContext, _newMessage: llm.ChatMessage) {
    if (this.#options.paused?.()) throw new voice.StopResponse();
    return Promise.resolve();
  }

  override llmNode(
    chatCtx: llm.ChatContext,
    _toolCtx: llm.ToolContext,
    _modelSettings: voice.ModelSettings,
  ): Promise<ReadableStream<llm.ChatChunk | string>> {
    const { persona, claude, model, effort, brain, ledger, logger, onUsage } = this.#options;
    const reply = ledger.start(brain.hangUpDue);
    const messages = withStateNote(
      buildProspectMessages(chatContextToTurns(chatCtx)),
      brain.note(),
      modelCapabilities(model),
    );
    const text = claudeTextStream({
      messages: claude,
      params: prospectRequest({ model, effort, persona, messages }),
      onComplete: (message) => {
        reply.actions = actionsFromMessage(message, logger);
        onUsage?.(message.model, usageOf(message));
        logUsage(logger, message, reply.actions);
      },
      closingText: (_message, spoke) => (spoke ? undefined : closingLine(reply.actions)),
      onRefusal: (message) =>
        logger.warn(
          { lane: 'prospect', stopDetails: message.stop_details, model: message.model },
          'prospect reply refused; speaking the neutral line',
        ),
      onError: (error) =>
        logger.error(
          { err: error, lane: 'prospect' },
          'prospect reply failed; speaking the neutral line',
        ),
    });
    return Promise.resolve(tagWithReplyId(reply.id, text));
  }
}

function logUsage(logger: Logger, message: BetaMessage, actions: readonly ProspectAction[]): void {
  const { usage } = message;
  logger.info(
    {
      lane: 'prospect',
      model: message.model,
      stopReason: message.stop_reason,
      tools: actions.map((a) => a.type),
      inputTokens: usage.input_tokens,
      cacheReadInputTokens: usage.cache_read_input_tokens,
      cacheCreationInputTokens: usage.cache_creation_input_tokens,
      outputTokens: usage.output_tokens,
    },
    'claude usage',
  );
}
