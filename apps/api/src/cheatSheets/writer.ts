// Cheat sheets on the API: one structured-output Claude call writes the page
// of notes for a real call from the rep's profile of the person they're about
// to call (core/cheatSheet/prompt.ts holds the prompt and the checks). Written
// on REVIEW_MODEL, the API's Claude model, at medium effort, while the rep waits.
import { APIUserAbortError } from '@anthropic-ai/sdk';
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import {
  CheatSheetDraft,
  type PriceTable,
  type ProductSpec,
  type RubricSpec,
} from '@ccc/contracts';
import {
  CHEAT_SHEET_MAX_TOKENS,
  CheatSheetError,
  type Effort,
  SERVER_FALLBACK_BETA,
  buildCheatSheetSystemPrompt,
  buildCheatSheetUserPrompt,
  cheatSheetFrom,
  costUsd,
  modelCapabilities,
  structuredFormat,
} from '@ccc/core';
import type { CreatingMessages, WriterLogger } from '../prospects/writer.ts';
import { describeClaudeError } from '../review/reviewer.ts';

/** A sheet takes under a minute to write; past two something is wrong. */
export const CHEAT_SHEET_TIMEOUT_MS = 120_000;
export const CHEAT_SHEET_EFFORT: Effort = 'medium';

export const NO_CHEAT_SHEET_WRITER_MESSAGE =
  'Cheat sheets need ANTHROPIC_API_KEY on the API: set it, restart, and try again.';

/** A failure worth showing the rep as it is. */
export class CheatSheetWriterError extends Error {
  override name = 'CheatSheetWriterError';
}

export interface WrittenCheatSheet {
  sheet: CheatSheetDraft;
  /** The model that answered. */
  model: string;
  /** Null if the model isn't in the price table. */
  costUsd: number | null;
}

export type CheatSheetWriter = (brief: string) => Promise<WrittenCheatSheet>;

/** Built once: an unchanged schema is compiled once by the API and then cached. */
const FORMAT = structuredFormat(CheatSheetDraft);

export function claudeCheatSheetWriter(options: {
  messages: CreatingMessages;
  model: string;
  product: ProductSpec;
  rubrics: readonly RubricSpec[];
  prices: PriceTable;
  logger: WriterLogger;
  timeoutMs?: number;
}): CheatSheetWriter {
  const {
    messages,
    model,
    product,
    rubrics,
    prices,
    logger,
    timeoutMs = CHEAT_SHEET_TIMEOUT_MS,
  } = options;

  return async (brief) => {
    // Every shipped prospect is marked on the same rubric; its 10/10 is the bar.
    const [rubric] = rubrics;
    if (!rubric) throw new CheatSheetWriterError('No rubric is loaded.');
    const caps = modelCapabilities(model);
    const started = performance.now();
    let message: BetaMessage;
    try {
      message = await messages.create(
        {
          model,
          max_tokens: CHEAT_SHEET_MAX_TOKENS,
          system: [
            {
              type: 'text',
              text: buildCheatSheetSystemPrompt({ product, rubric }),
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [{ role: 'user', content: buildCheatSheetUserPrompt({ brief }) }],
          output_config: {
            ...(caps.effort ? { effort: CHEAT_SHEET_EFFORT } : {}),
            format: FORMAT,
          },
          ...(caps.serverFallbacks ? { betas: [SERVER_FALLBACK_BETA], fallbacks: 'default' } : {}),
        },
        { signal: AbortSignal.timeout(timeoutMs) },
      );
    } catch (error) {
      if (error instanceof APIUserAbortError) {
        throw new CheatSheetWriterError(
          `Claude took more than ${Math.round(timeoutMs / 60_000)} minutes writing this cheat sheet. Try again.`,
          { cause: error },
        );
      }
      throw new CheatSheetWriterError(describeClaudeError(error), { cause: error });
    }
    const usage = {
      inputTokens: message.usage.input_tokens,
      cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
      outputTokens: message.usage.output_tokens,
    };
    const cost = costUsd(message.model, usage, prices);
    logger.info(
      {
        lane: 'cheat-sheet',
        model: message.model,
        ms: Math.round(performance.now() - started),
        stopReason: message.stop_reason,
        ...usage,
        costUsd: cost,
      },
      'claude usage',
    );
    if (message.stop_reason === 'refusal') {
      throw new CheatSheetWriterError(
        'Claude declined to write this cheat sheet. Try describing the call differently.',
      );
    }
    if (message.stop_reason === 'max_tokens') {
      throw new CheatSheetWriterError(
        'Claude ran out of room writing this cheat sheet. Try again.',
      );
    }
    const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    let draft: CheatSheetDraft;
    try {
      draft = FORMAT.parse(text);
    } catch (error) {
      throw new CheatSheetWriterError("Claude's answer came back malformed. Try again.", {
        cause: error,
      });
    }
    try {
      return { sheet: cheatSheetFrom(draft), model: message.model, costUsd: cost };
    } catch (error) {
      if (error instanceof CheatSheetError) {
        throw new CheatSheetWriterError(error.message, { cause: error });
      }
      throw error;
    }
  };
}
