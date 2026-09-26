// The judge lane: one structured-output Claude call per rep turn (PLAN.md §6.3).
// It runs beside the prospect's reply and never delays it; a failure costs a
// turn's judgement, never the call.
import type {
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { JudgeResult } from '@ccc/contracts';
import type { Effort, TokenUsage } from '@ccc/core';
import { judgeRequest } from '../claude/requests.ts';

/** Give up on a judgement after this long; the next turn is judged regardless. */
export const JUDGE_TIMEOUT_MS = 15_000;

/** The slice of `client.beta.messages` the judge uses; a fake satisfies it in tests. */
export interface ParsingMessages {
  parse(
    params: MessageCreateParamsNonStreaming,
    options?: { signal?: AbortSignal },
  ): PromiseLike<BetaMessage & { parsed_output: unknown }>;
}

export interface JudgeLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

/** Scores one rep turn from its prompt; resolves null when no judgement could be had. */
export type Judge = (prompt: { system: string; user: string }) => Promise<JudgeResult | null>;

export function claudeJudge(options: {
  messages: ParsingMessages;
  model: string;
  effort: Effort;
  logger: JudgeLogger;
  timeoutMs?: number;
  /** Every answered call's usage, by the model that answered (the call log sums it). */
  onUsage?: (model: string, usage: TokenUsage) => void;
}): Judge {
  const { messages, model, effort, logger, timeoutMs = JUDGE_TIMEOUT_MS, onUsage } = options;
  return async ({ system, user }) => {
    const started = performance.now();
    try {
      const message = await messages.parse(judgeRequest({ model, effort, system, user }), {
        signal: AbortSignal.timeout(timeoutMs),
      });
      const ms = Math.round(performance.now() - started);
      onUsage?.(message.model, usageOf(message));
      logger.info(
        {
          lane: 'judge',
          model: message.model,
          ms,
          stopReason: message.stop_reason,
          inputTokens: message.usage.input_tokens,
          cacheReadInputTokens: message.usage.cache_read_input_tokens,
          outputTokens: message.usage.output_tokens,
        },
        'claude usage',
      );
      if (message.stop_reason === 'refusal' || message.parsed_output == null) {
        logger.warn({ lane: 'judge', stopReason: message.stop_reason }, 'no judgement returned');
        return null;
      }
      // parse() has already validated it against the JudgeResult schema.
      return message.parsed_output as JudgeResult;
    } catch (error) {
      logger.warn(
        { lane: 'judge', err: error, ms: Math.round(performance.now() - started) },
        'judge call failed',
      );
      return null;
    }
  };
}

/** A Claude message's token counts in the shape the pricing and call log use. */
export const usageOf = (message: Pick<BetaMessage, 'usage'>): TokenUsage => ({
  inputTokens: message.usage.input_tokens,
  cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
  cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
  outputTokens: message.usage.output_tokens,
});
