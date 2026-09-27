// The Get help button (PLAN.md §8.3, where it was the Hint): one quick
// structured-output Claude call for the words the rep should say next, why, and a
// follow-up if she pushes back, on the coach's model. It runs on the RPC path,
// never the prospect's: she keeps talking while it thinks.
import type { HintDraft, HintResponse } from '@ccc/contracts';
import { type Effort, type TokenUsage, helpFrom } from '@ccc/core';
import { hintRequest } from '../claude/requests.ts';
import { CLAUDE_TIMED_OUT, CLAUDE_UNREACHABLE, describeClaudeFailure } from '../failures.ts';
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
}) => Promise<HintResponse & { ms: number }>;

/** What failed help tells the rep. */
export function describeHintError(error: unknown): string {
  if (error instanceof HintError) return error.message;
  const failure = describeClaudeFailure(error);
  if (failure === CLAUDE_TIMED_OUT) return 'Help took too long. Try again.';
  if (failure === CLAUDE_UNREACHABLE) return "Couldn't get help. Try again.";
  return failure;
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
      throw new HintError('The coach declined to help here.');
    }
    // parse() has already validated it against the HintDraft schema.
    const help = helpFrom(message.parsed_output as HintDraft | null);
    if (!help) throw new HintError('Help came back empty. Try again.');
    return { ...help, ms };
  };
}
