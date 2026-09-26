import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { type Effort, buildProspectMessages } from '@ccc/core';
import { llm, voice } from '@livekit/agents';
import type { ReadableStream } from 'node:stream/web';
import { chatContextToTurns } from '../chat.ts';
import { prospectRequest } from '../claude/requests.ts';
import { type StreamingMessages, claudeTextStream } from '../claude/textStream.ts';
import type { Logger } from '../log.ts';

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
  persona: string;
  claude: StreamingMessages;
  model: string;
  effort: Effort;
  logger: Logger;
}

/**
 * The prospect. Its `llmNode` rebuilds the Claude conversation from LiveKit's
 * chat context every turn and streams the reply straight into TTS; nothing
 * else is awaited on this path (PLAN.md §15).
 */
export class ProspectAgent extends voice.Agent {
  readonly #options: ProspectAgentOptions;

  constructor(options: ProspectAgentOptions) {
    super({ instructions: options.persona, llm: new DirectClaudeLLM(options.model) });
    this.#options = options;
  }

  override llmNode(
    chatCtx: llm.ChatContext,
    _toolCtx: llm.ToolContext,
    _modelSettings: voice.ModelSettings,
  ): Promise<ReadableStream<string>> {
    const { persona, claude, model, effort, logger } = this.#options;
    const messages = buildProspectMessages(chatContextToTurns(chatCtx));
    return Promise.resolve(
      claudeTextStream({
        messages: claude,
        params: prospectRequest({ model, effort, persona, messages }),
        onComplete: (message) => logUsage(logger, message),
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
      }),
    );
  }
}

function logUsage(logger: Logger, message: BetaMessage): void {
  const { usage } = message;
  logger.info(
    {
      lane: 'prospect',
      model: message.model,
      stopReason: message.stop_reason,
      inputTokens: usage.input_tokens,
      cacheReadInputTokens: usage.cache_read_input_tokens,
      cacheCreationInputTokens: usage.cache_creation_input_tokens,
      outputTokens: usage.output_tokens,
    },
    'claude usage',
  );
}
