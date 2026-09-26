// The Hint button (PLAN.md §8.3): one quick structured-output Claude call for
// three lines the rep could say next, on the coach's model. It runs on the
// RPC path, never the prospect's: she keeps talking while it thinks.
import { APIError, APIUserAbortError } from '@anthropic-ai/sdk';
import type { HintDraft } from '@ccc/contracts';
import { type Effort, type TokenUsage, hintSuggestions } from '@ccc/core';
import { hintRequest } from '../claude/requests.ts';
import { type ParsingMessages, usageOf } from '../judge/judge.ts';

/** PLAN.md's target is about 2 s; past this the rep has moved on. */
export const HINT_TIMEOUT_MS = 8_000;

/** A failure worth showing the rep as it is. */
export class HintError extends Error {}

export interface HintLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export type HintSource = (prompt: {
  system: string;
  user: string;
}) => Promise<{ suggestions: string[]; ms: number }>;

/** What a failed hint tells the rep. */
export function describeHintError(error: unknown): string {
  if (error instanceof HintError) return error.message;
  if (
    error instanceof APIUserAbortError ||
    (error instanceof Error && error.name === 'TimeoutError')
  ) {
    return 'The hint took too long. Try again.';
  }
  if (error instanceof APIError) {
    if (error.status === 401 || error.status === 403) {
      return "Claude rejected the agent's key: check ANTHROPIC_API_KEY.";
    }
    if (error.status === 429) return 'Claude is rate-limiting hints. Try again in a moment.';
    if (error.status === 529 || error.status === 503) return 'Claude is overloaded. Try again.';
  }
  return "Couldn't get a hint. Try again.";
}

export function claudeHints(options: {
  messages: ParsingMessages;
  model: string;
  effort: Effort;
  logger: HintLogger;
  timeoutMs?: number;
  /** Every answered call's usage, by the model that answered. */
  onUsage?: (model: string, usage: TokenUsage) => void;
}): HintSource {
  const { messages, model, effort, logger, timeoutMs = HINT_TIMEOUT_MS, onUsage } = options;
  return async ({ system, user }) => {
    const started = performance.now();
    const message = await messages.parse(hintRequest({ model, effort, system, user }), {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ms = Math.round(performance.now() - started);
    onUsage?.(message.model, usageOf(message));
    logger.info(
      {
        lane: 'hint',
        model: message.model,
        ms,
        stopReason: message.stop_reason,
        inputTokens: message.usage.input_tokens,
        cacheReadInputTokens: message.usage.cache_read_input_tokens,
        outputTokens: message.usage.output_tokens,
      },
      'claude usage',
    );
    if (message.stop_reason === 'refusal') {
      throw new HintError('The coach declined to suggest lines here.');
    }
    // parse() has already validated it against the HintDraft schema.
    const draft = message.parsed_output as HintDraft | null;
    const suggestions = hintSuggestions(draft?.suggestions ?? []);
    if (!suggestions.length) throw new HintError('The hint came back empty. Try again.');
    return { suggestions, ms };
  };
}
