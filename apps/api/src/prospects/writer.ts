// "Add new" on the API: one structured-output Claude call writes a prospect
// from the rep's description (core/prospect/writer.ts holds the prompt and the
// checks), choosing her voice from Cartesia's library when the API can read it.
// Written on REVIEW_MODEL, the API's Claude model, at medium effort.
import { randomBytes } from 'node:crypto';
import type {
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import {
  type PriceTable,
  ProspectDraft,
  type ScenarioCatalog,
  type ScenarioSpec,
  type VoiceChoice,
} from '@ccc/contracts';
import {
  type Effort,
  type ModelCall,
  PROSPECT_WRITER_MAX_TOKENS,
  ProspectDraftError,
  SERVER_FALLBACK_BETA,
  buildProspectWriterSystemPrompt,
  buildProspectWriterUserPrompt,
  costUsd,
  modelCapabilities,
  prospectId,
  scenarioFromDraft,
  structuredFormat,
} from '@ccc/core';
import { z } from 'zod';
import { describeClaudeError } from '../review/reviewer.ts';
import type { VoiceLibrary } from './voices.ts';

/** She takes 20–40 s to write; past two minutes something is wrong. */
export const PROSPECT_WRITER_TIMEOUT_MS = 120_000;
export const PROSPECT_WRITER_EFFORT: Effort = 'medium';

export const NO_WRITER_MESSAGE =
  'Adding prospects needs ANTHROPIC_API_KEY on the API: set it, restart, and try again.';

/** A failure worth showing the rep as it is. */
export class ProspectWriterError extends Error {
  override name = 'ProspectWriterError';
}

export interface WrittenProspect {
  scenario: ScenarioSpec;
  /** `chosen`: from the voice library. `default`: the agent's CARTESIA_VOICE_ID. */
  voice: 'chosen' | 'default';
}

/**
 * Writes a prospect from the rep's description; with a model call the rep has
 * read ("Practise this call"), she is kept consistent with it.
 */
export type ProspectWriter = (
  description: string,
  modelCall?: ModelCall,
) => Promise<WrittenProspect>;

/** The slice of `client.beta.messages` the writer uses; a fake satisfies it in tests. */
export interface CreatingMessages {
  create(
    params: MessageCreateParamsNonStreaming,
    options?: { signal?: AbortSignal },
  ): PromiseLike<BetaMessage>;
}

export interface WriterLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

type Draft = ProspectDraft & { voiceId?: string };

/** The draft's schema: with her voice as one of the library's ids when there are any. */
function draftSchema(voices: readonly VoiceChoice[]): z.ZodType<Draft> {
  const [first, ...rest] = voices.map((v) => v.id);
  if (first === undefined) return ProspectDraft;
  return ProspectDraft.extend({
    voiceId: z.enum([first, ...rest]).describe('Her voice: the id of one voice from the list'),
  });
}

export function claudeProspectWriter(options: {
  messages: CreatingMessages;
  model: string;
  catalog: ScenarioCatalog;
  /** Null: no CARTESIA_API_KEY on the API, so every new prospect gets the default voice. */
  voices: VoiceLibrary | null;
  prices: PriceTable;
  logger: WriterLogger;
  timeoutMs?: number;
  /** The random end of her id; a test can fix it. */
  suffix?: () => string;
}): ProspectWriter {
  const {
    messages,
    model,
    catalog,
    prices,
    logger,
    timeoutMs = PROSPECT_WRITER_TIMEOUT_MS,
    suffix = () => randomBytes(3).toString('hex'),
  } = options;

  const readVoices = async (): Promise<VoiceChoice[]> => {
    if (!options.voices) return [];
    try {
      return await options.voices.voices();
    } catch (error) {
      logger.warn(
        { err: error },
        "couldn't read Cartesia's voice library; using the default voice",
      );
      return [];
    }
  };

  return async (description, modelCall) => {
    const voices = await readVoices();
    const format = structuredFormat(draftSchema(voices));
    const caps = modelCapabilities(model);
    const started = performance.now();
    let message: BetaMessage;
    try {
      message = await messages.create(
        {
          model,
          max_tokens: PROSPECT_WRITER_MAX_TOKENS,
          system: buildProspectWriterSystemPrompt({
            product: catalog.product,
            examples: catalog.scenarios,
            voices,
          }),
          messages: [
            { role: 'user', content: buildProspectWriterUserPrompt(description, modelCall) },
          ],
          output_config: {
            ...(caps.effort ? { effort: PROSPECT_WRITER_EFFORT } : {}),
            format,
          },
          ...(caps.serverFallbacks ? { betas: [SERVER_FALLBACK_BETA], fallbacks: 'default' } : {}),
        },
        { signal: AbortSignal.timeout(timeoutMs) },
      );
    } catch (error) {
      throw new ProspectWriterError(describeClaudeError(error), { cause: error });
    }
    const usage = {
      inputTokens: message.usage.input_tokens,
      cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
      outputTokens: message.usage.output_tokens,
    };
    logger.info(
      {
        lane: 'prospect-writer',
        model: message.model,
        ms: Math.round(performance.now() - started),
        stopReason: message.stop_reason,
        voices: voices.length,
        ...usage,
        costUsd: costUsd(message.model, usage, prices),
      },
      'claude usage',
    );
    if (message.stop_reason === 'refusal') {
      throw new ProspectWriterError(
        'Claude declined to write this prospect. Try describing her differently.',
      );
    }
    if (message.stop_reason === 'max_tokens') {
      throw new ProspectWriterError('Claude ran out of room writing her. Try again.');
    }
    const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    let draft: Draft;
    try {
      draft = format.parse(text);
    } catch (error) {
      throw new ProspectWriterError("Claude's answer came back malformed. Try again.", {
        cause: error,
      });
    }
    try {
      const scenario = scenarioFromDraft(draft, {
        id: prospectId(draft.prospect.name, suffix()),
        templates: catalog.scenarios,
        difficulty: modelCall?.prospect.difficulty,
      });
      return { scenario, voice: draft.voiceId ? 'chosen' : 'default' };
    } catch (error) {
      if (error instanceof ProspectDraftError) {
        throw new ProspectWriterError(error.message, { cause: error });
      }
      throw error;
    }
  };
}
