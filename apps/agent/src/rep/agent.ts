// Sam, in a reverse call: the rep plays the prospect and Claude makes the call.
// Built as ProspectAgent is: `llmNode` rebuilds the conversation from LiveKit's
// chat context every turn and streams the reply straight into TTS, and nothing
// else is awaited on that path. He has no hidden state and no note: the
// rep, playing her, decides how the call goes. There is no STT tap either: the
// words Deepgram times are the rep's, and the log keeps word timings for rep
// turns, which in a reverse call are Sam's.
import type { ReadableStream } from 'node:stream/web';
import { type Effort, type TokenUsage, buildRepMessages } from '@ccc/core';
import { type llm, voice } from '@livekit/agents';
import { chatContextToTurns } from '../chat.ts';
import { repRequest } from '../claude/requests.ts';
import { type StreamingMessages, claudeTextStream } from '../claude/textStream.ts';
import { usageOf } from '../judge/judge.ts';
import type { Logger } from '../logger.ts';
import { DirectClaudeLLM, tagWithReplyId } from '../prospect/agent.ts';
import type { ReplyLedger } from '../prospect/replies.ts';
import { type RepAction, repActionsFromMessage, repClosingLine } from './tools.ts';

export interface RepAgentOptions {
  /** buildRepSystemPrompt(...): fixed for the call, so it caches. */
  system: string;
  claude: StreamingMessages;
  model: string;
  effort: Effort;
  ledger: ReplyLedger<RepAction>;
  logger: Logger;
  /** Every finished reply's usage, by the model that answered. */
  onUsage?: (model: string, usage: TokenUsage) => void;
  /** His reply failed (he spoke the neutral line instead): the rep should know why. */
  onReplyFailed?: (error: unknown) => void;
}

export class RepAgent extends voice.Agent {
  readonly #options: RepAgentOptions;

  constructor(options: RepAgentOptions) {
    super({ instructions: options.system, llm: new DirectClaudeLLM(options.model) });
    this.#options = options;
  }

  override llmNode(
    chatCtx: llm.ChatContext,
    _toolCtx: llm.ToolContext,
    _modelSettings: voice.ModelSettings,
  ): Promise<ReadableStream<llm.ChatChunk | string>> {
    const { system, claude, model, effort, ledger, logger, onUsage, onReplyFailed } = this.#options;
    const reply = ledger.start(false);
    const messages = buildRepMessages(chatContextToTurns(chatCtx, 'rep'));
    const text = claudeTextStream({
      messages: claude,
      params: repRequest({ model, effort, system, messages }),
      onComplete: (message) => {
        reply.actions = repActionsFromMessage(message, logger);
        onUsage?.(message.model, usageOf(message));
        logger.info(
          {
            lane: 'rep',
            model: message.model,
            stopReason: message.stop_reason,
            tools: reply.actions.map((a) => a.type),
            inputTokens: message.usage.input_tokens,
            cacheReadInputTokens: message.usage.cache_read_input_tokens,
            cacheCreationInputTokens: message.usage.cache_creation_input_tokens,
            outputTokens: message.usage.output_tokens,
          },
          'claude usage',
        );
      },
      closingText: (_message, spoke) => (spoke ? undefined : repClosingLine(reply.actions)),
      onRefusal: (message) =>
        logger.warn(
          { lane: 'rep', stopDetails: message.stop_details, model: message.model },
          "Sam's reply refused; speaking the neutral line",
        ),
      onError: (error) => {
        logger.error({ err: error, lane: 'rep' }, "Sam's reply failed; speaking the neutral line");
        onReplyFailed?.(error);
      },
    });
    return Promise.resolve(tagWithReplyId(reply.id, text));
  }
}
