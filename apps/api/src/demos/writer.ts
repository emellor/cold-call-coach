// The demo calls' writer: one structured-output Claude call writes a whole
// model cold call, to one prospect or from the rep's brief (core/demos/script.ts
// holds the prompts and the checks). Written on REVIEW_MODEL, the API's Claude
// model, at medium effort. The system prompt is the same for every demo, so it
// is cached.
import { APIUserAbortError } from '@anthropic-ai/sdk';
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import {
  DemoBriefDraft,
  type DemoProspect,
  DemoScriptDraft,
  type PriceTable,
  type ProductSpec,
  type RubricSpec,
  type ScenarioSpec,
} from '@ccc/contracts';
import {
  DEMO_SCRIPT_MAX_TOKENS,
  type DemoScript,
  DemoScriptError,
  type Effort,
  SERVER_FALLBACK_BETA,
  briefScriptFrom,
  buildDemoBriefUserPrompt,
  buildDemoScriptSystemPrompt,
  buildDemoScriptUserPrompt,
  costUsd,
  modelCapabilities,
  scriptFrom,
  structuredFormat,
} from '@ccc/core';
import type { CreatingMessages, WriterLogger } from '../prospects/writer.ts';
import { describeClaudeError } from '../review/reviewer.ts';

/** A demo takes about a minute to write; past three something is wrong. */
export const DEMO_WRITER_TIMEOUT_MS = 180_000;
export const DEMO_WRITER_EFFORT: Effort = 'medium';

export const NO_DEMO_WRITER_MESSAGE =
  'Demo calls need ANTHROPIC_API_KEY on the API: set it, restart, and try again.';

/** A failure worth showing on the demo as it is. */
export class DemoWriterError extends Error {
  override name = 'DemoWriterError';
}

export interface WrittenDemo extends DemoScript {
  /** Who a demo from a brief called, as Claude wrote them. */
  prospect?: DemoProspect;
  /** The model that answered. */
  model: string;
  /** Null if the model isn't in the price table. */
  costUsd: number | null;
}

/** A call to one of the stored prospects with a given approach, or one from the rep's brief. */
export type DemoWriterInput = { scenario: ScenarioSpec; angle: string } | { brief: string };

export type DemoWriter = (input: DemoWriterInput) => Promise<WrittenDemo>;

/** Built once: an unchanged schema is compiled once by the API and then cached. */
const FORMAT = structuredFormat(DemoScriptDraft);
const BRIEF_FORMAT = structuredFormat(DemoBriefDraft);

export function claudeDemoWriter(options: {
  messages: CreatingMessages;
  model: string;
  product: ProductSpec;
  rubrics: readonly RubricSpec[];
  prices: PriceTable;
  logger: WriterLogger;
  timeoutMs?: number;
}): DemoWriter {
  const {
    messages,
    model,
    product,
    rubrics,
    prices,
    logger,
    timeoutMs = DEMO_WRITER_TIMEOUT_MS,
  } = options;

  return async (input) => {
    // A brief has no stored prospect to name a rubric; every shipped one uses the same.
    const rubricId = 'brief' in input ? rubrics[0]?.id : input.scenario.rubricId;
    const rubric = rubrics.find((r) => r.id === rubricId);
    if (!rubric) throw new DemoWriterError(`The rubric "${rubricId ?? ''}" is not loaded.`);
    const caps = modelCapabilities(model);
    const started = performance.now();
    let message: BetaMessage;
    try {
      message = await messages.create(
        {
          model,
          max_tokens: DEMO_SCRIPT_MAX_TOKENS,
          system: [
            {
              type: 'text',
              text: buildDemoScriptSystemPrompt({ product, rubric }),
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [
            {
              role: 'user',
              content:
                'brief' in input
                  ? buildDemoBriefUserPrompt(input)
                  : buildDemoScriptUserPrompt(input),
            },
          ],
          output_config: {
            ...(caps.effort ? { effort: DEMO_WRITER_EFFORT } : {}),
            format: 'brief' in input ? BRIEF_FORMAT : FORMAT,
          },
          ...(caps.serverFallbacks ? { betas: [SERVER_FALLBACK_BETA], fallbacks: 'default' } : {}),
        },
        { signal: AbortSignal.timeout(timeoutMs) },
      );
    } catch (error) {
      if (error instanceof APIUserAbortError) {
        throw new DemoWriterError(
          `Claude took more than ${Math.round(timeoutMs / 60_000)} minutes writing this call. Retry it.`,
          { cause: error },
        );
      }
      throw new DemoWriterError(describeClaudeError(error), { cause: error });
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
        lane: 'demo-writer',
        model: message.model,
        ms: Math.round(performance.now() - started),
        stopReason: message.stop_reason,
        ...usage,
        costUsd: cost,
      },
      'claude usage',
    );
    if (message.stop_reason === 'refusal') {
      throw new DemoWriterError('Claude declined to write this call. Retry it.');
    }
    if (message.stop_reason === 'max_tokens') {
      throw new DemoWriterError('Claude ran out of room writing this call. Retry it.');
    }
    const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    let finish: () => DemoScript;
    try {
      if ('brief' in input) {
        const draft = BRIEF_FORMAT.parse(text);
        finish = () => briefScriptFrom(draft);
      } else {
        const draft = FORMAT.parse(text);
        finish = () => scriptFrom(draft, input.scenario.prospect.openingLine);
      }
    } catch (error) {
      throw new DemoWriterError("Claude's answer came back malformed. Retry it.", {
        cause: error,
      });
    }
    try {
      return { ...finish(), model: message.model, costUsd: cost };
    } catch (error) {
      if (error instanceof DemoScriptError) {
        throw new DemoWriterError(error.message, { cause: error });
      }
      throw error;
    }
  };
}
