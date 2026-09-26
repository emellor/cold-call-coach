// The review lane: one Claude call per finished call (PLAN.md §8.4), on
// REVIEW_MODEL at REVIEW_EFFORT, constrained to ReviewDraft by structured
// output. Streamed, so a long high-effort answer never trips a request timeout,
// and read as raw events: the SDK's stream helper parses the JSON itself at
// the end, which would hide a refusal or a max_tokens cut behind a parse error.
import { APIError } from '@anthropic-ai/sdk';
import type {
  BetaRawMessageStreamEvent,
  BetaStopReason,
  MessageCreateParamsStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { type PriceTable, ReviewDraft } from '@ccc/contracts';
import {
  type Effort,
  type ReviewPromptInput,
  SERVER_FALLBACK_BETA,
  type TokenUsage,
  buildReviewSystemPrompt,
  buildReviewUserPrompt,
  costUsd,
  modelCapabilities,
  structuredFormat,
} from '@ccc/core';

/** A full review is ~1–2k tokens of JSON; the rest is room for high-effort thinking. */
export const REVIEW_MAX_TOKENS = 16_000;
export const REVIEW_TIMEOUT_MS = 180_000;

const REVIEW_FORMAT = structuredFormat(ReviewDraft);

export interface ReviewOutcome {
  draft: ReviewDraft;
  /** The model that answered (a server-side fallback may differ from the one asked). */
  model: string;
  usage: TokenUsage;
  costUsd: number | null;
}

/** Writes a review draft for one call. Throws with a message fit to show the rep. */
export type Reviewer = (input: ReviewPromptInput) => Promise<ReviewOutcome>;

/** The slice of `client.beta.messages` the review uses; a fake satisfies it in tests. */
export interface StreamingMessages {
  create(
    params: MessageCreateParamsStreaming,
    options?: { signal?: AbortSignal },
  ): PromiseLike<AsyncIterable<BetaRawMessageStreamEvent>>;
}

export class ReviewError extends Error {
  override name = 'ReviewError';
}

export function reviewRequest(options: {
  model: string;
  effort: Effort;
  input: ReviewPromptInput;
}): MessageCreateParamsStreaming {
  const { model, effort, input } = options;
  const caps = modelCapabilities(model);
  return {
    model,
    stream: true,
    max_tokens: REVIEW_MAX_TOKENS,
    system: [
      {
        type: 'text',
        text: buildReviewSystemPrompt(input),
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: buildReviewUserPrompt(input) }],
    output_config: { ...(caps.effort ? { effort } : {}), format: REVIEW_FORMAT },
    ...(caps.serverFallbacks ? { betas: [SERVER_FALLBACK_BETA], fallbacks: 'default' } : {}),
  };
}

/** A Claude API failure in words the rep can act on. */
export function describeClaudeError(error: unknown): string {
  if (!(error instanceof APIError)) {
    return error instanceof Error ? error.message : String(error);
  }
  if (error.status === 401 || error.status === 403) {
    return "Claude rejected the API's key: check ANTHROPIC_API_KEY in the API's .env.";
  }
  if (error.status === 429) return 'Claude is rate-limiting the review. Try again in a minute.';
  if (error.status === 529 || error.status === 503)
    return 'Claude is overloaded. Try again shortly.';
  if (error.status === undefined)
    return "Couldn't reach Claude. Check the API's network and try again.";
  return `Claude answered ${error.status}: ${error.message}`;
}

/** What the stream said, gathered from its events. */
interface Streamed {
  model: string;
  text: string;
  stopReason: BetaStopReason | null;
  usage: TokenUsage;
}

async function readStream(
  events: AsyncIterable<BetaRawMessageStreamEvent>,
  model: string,
): Promise<Streamed> {
  const out: Streamed = {
    model,
    text: '',
    stopReason: null,
    usage: {
      inputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 0,
    },
  };
  for await (const event of events) {
    if (event.type === 'message_start') {
      const { usage } = event.message;
      out.model = event.message.model;
      out.usage = {
        inputTokens: usage.input_tokens,
        cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
        outputTokens: usage.output_tokens,
      };
    } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      out.text += event.delta.text;
    } else if (event.type === 'message_delta') {
      out.stopReason = event.delta.stop_reason ?? out.stopReason;
      out.usage.outputTokens = event.usage.output_tokens;
    }
  }
  return out;
}

export function claudeReviewer(options: {
  messages: StreamingMessages;
  model: string;
  effort: Effort;
  /** Prices the review's tokens (config/prices.json). */
  prices: PriceTable;
  timeoutMs?: number;
}): Reviewer {
  const { messages, model, effort, prices, timeoutMs = REVIEW_TIMEOUT_MS } = options;
  return async (input) => {
    let streamed: Streamed;
    try {
      const events = await messages.create(reviewRequest({ model, effort, input }), {
        signal: AbortSignal.timeout(timeoutMs),
      });
      streamed = await readStream(events, model);
    } catch (error) {
      throw new ReviewError(describeClaudeError(error), { cause: error });
    }
    if (streamed.stopReason === 'refusal') {
      throw new ReviewError('Claude declined to review this call.');
    }
    if (streamed.stopReason === 'max_tokens') {
      throw new ReviewError('The review ran out of room before it finished. Try again.');
    }
    let draft: ReviewDraft;
    try {
      draft = REVIEW_FORMAT.parse(streamed.text);
    } catch (error) {
      throw new ReviewError('The review came back malformed. Try again.', { cause: error });
    }
    return {
      draft,
      model: streamed.model,
      usage: streamed.usage,
      costUsd: costUsd(streamed.model, streamed.usage, prices),
    };
  };
}
