// A reverse call's notes: once the call is over, one structured-output Claude
// call annotates Sam's side (core/rep/notes.ts holds the prompt and the
// checks). On REVIEW_MODEL, the API's Claude model, at medium effort like the
// demos it resembles: the notes are short, and the review lane's default high
// effort would spend more thinking than they need.
import { APIUserAbortError } from '@anthropic-ai/sdk';
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import {
  type CallOutcome,
  type PriceTable,
  type ProductSpec,
  type RepNotes,
  RepNotesDraft,
  type ScenarioSpec,
} from '@ccc/contracts';
import {
  type Effort,
  REP_NOTES_MAX_TOKENS,
  RepNotesError,
  type RepNotesTurn,
  SERVER_FALLBACK_BETA,
  buildRepNotesSystemPrompt,
  buildRepNotesUserPrompt,
  costUsd,
  modelCapabilities,
  repNotesFrom,
  structuredFormat,
} from '@ccc/core';
import type { CreatingMessages } from '../prospects/writer.ts';
import { describeClaudeError } from './reviewer.ts';

/** Notes take under a minute; past two something is wrong. */
export const REP_NOTES_TIMEOUT_MS = 120_000;
export const REP_NOTES_EFFORT: Effort = 'medium';

export interface RepNotesInput {
  scenario: ScenarioSpec;
  product: ProductSpec;
  turns: readonly RepNotesTurn[];
  outcome: CallOutcome;
  outcomeReason: string | null;
}

export interface RepNotesOutcome {
  notes: RepNotes;
  /** The model that answered (a server-side fallback may differ from the one asked). */
  model: string;
  /** Null if the model isn't in the price table. */
  costUsd: number | null;
}

/** Writes the notes on Sam's side of one reverse call. Throws with a message fit to show the rep. */
export type RepNoter = (input: RepNotesInput) => Promise<RepNotesOutcome>;

/** Built once: an unchanged schema is compiled once by the API and then cached. */
const FORMAT = structuredFormat(RepNotesDraft);

export function claudeRepNoter(options: {
  messages: CreatingMessages;
  model: string;
  prices: PriceTable;
  timeoutMs?: number;
}): RepNoter {
  const { messages, model, prices, timeoutMs = REP_NOTES_TIMEOUT_MS } = options;
  return async (input) => {
    const caps = modelCapabilities(model);
    let message: BetaMessage;
    try {
      message = await messages.create(
        {
          model,
          max_tokens: REP_NOTES_MAX_TOKENS,
          system: [
            {
              type: 'text',
              text: buildRepNotesSystemPrompt({ product: input.product }),
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [{ role: 'user', content: buildRepNotesUserPrompt(input) }],
          output_config: {
            ...(caps.effort ? { effort: REP_NOTES_EFFORT } : {}),
            format: FORMAT,
          },
          ...(caps.serverFallbacks ? { betas: [SERVER_FALLBACK_BETA], fallbacks: 'default' } : {}),
        },
        { signal: AbortSignal.timeout(timeoutMs) },
      );
    } catch (error) {
      if (error instanceof APIUserAbortError) {
        throw new RepNotesError(
          `Claude took more than ${Math.round(timeoutMs / 60_000)} minutes writing the notes. Try again.`,
          { cause: error },
        );
      }
      throw new RepNotesError(describeClaudeError(error), { cause: error });
    }
    if (message.stop_reason === 'refusal') {
      throw new RepNotesError('Claude declined to write notes on this call.');
    }
    if (message.stop_reason === 'max_tokens') {
      throw new RepNotesError('Claude ran out of room writing the notes. Try again.');
    }
    const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    let draft: RepNotesDraft;
    try {
      draft = FORMAT.parse(text);
    } catch (error) {
      throw new RepNotesError("Claude's notes came back malformed. Try again.", { cause: error });
    }
    const usage = {
      inputTokens: message.usage.input_tokens,
      cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
      outputTokens: message.usage.output_tokens,
    };
    return {
      notes: repNotesFrom(draft, input.turns),
      model: message.model,
      costUsd: costUsd(message.model, usage, prices),
    };
  };
}
