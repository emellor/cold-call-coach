import { APIUserAbortError } from '@anthropic-ai/sdk';
import type {
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { describe, expect, it, vi } from 'vitest';
import { readPriceTable } from '../prices.ts';
import type { CreatingMessages } from '../prospects/writer.ts';
import { testCatalog } from '../test/catalog.ts';
import { sheetDraft } from '../test/cheatSheets.ts';
import { CHEAT_SHEET_EFFORT, CheatSheetWriterError, claudeCheatSheetWriter } from './writer.ts';

const prices = await readPriceTable();
const BRIEF =
  'Sarah Patel, Head of Estates at Carewell, 14 care homes. Objective: a 20-minute call.';

function answer(patch: Partial<BetaMessage> & { json?: unknown } = {}) {
  const { json = sheetDraft, ...rest } = patch;
  return {
    model: 'claude-opus-5-5',
    stop_reason: 'end_turn',
    usage: { input_tokens: 400, output_tokens: 2_000, cache_read_input_tokens: 1_000 },
    content: [{ type: 'text', text: JSON.stringify(json) }],
    ...rest,
  } as BetaMessage;
}

function writerWith(reply: () => Promise<BetaMessage> = () => Promise.resolve(answer())) {
  const sent: MessageCreateParamsNonStreaming[] = [];
  const messages: CreatingMessages = {
    create: (params) => {
      sent.push(params);
      return reply();
    },
  };
  const logger = { info: vi.fn(), warn: vi.fn() };
  const write = claudeCheatSheetWriter({
    messages,
    model: 'claude-opus-5-5',
    product: testCatalog.product,
    rubrics: testCatalog.rubrics,
    prices,
    logger,
  });
  return { write, sent, logger };
}

describe('claudeCheatSheetWriter', () => {
  it('writes the sheet in one structured-output request, with the shared prompt cached', async () => {
    const { write, sent, logger } = writerWith();
    const written = await write(BRIEF);

    expect(sent).toHaveLength(1);
    const [params] = sent;
    expect(params).toMatchObject({
      model: 'claude-opus-5-5',
      output_config: { effort: CHEAT_SHEET_EFFORT, format: { type: 'json_schema' } },
      fallbacks: 'default',
    });
    expect(params).not.toHaveProperty('thinking');
    expect(params?.system).toEqual([
      expect.objectContaining({ type: 'text', cache_control: { type: 'ephemeral' } }),
    ]);
    // The writer sends the user turn as one string.
    expect(params?.messages[0]?.content as string).toContain(`<profile>\n${BRIEF}\n</profile>`);

    expect(written.sheet).toEqual(sheetDraft);
    // 400 × $4 + 1,000 × $0.20 + 2,000 × $20, per million tokens.
    expect(written.costUsd).toBeCloseTo(0.0418, 6);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ lane: 'cheat-sheet', costUsd: written.costUsd }),
      'claude usage',
    );
  });

  it('fails with words the rep can act on', async () => {
    const said = (reply: () => Promise<BetaMessage>) =>
      writerWith(reply)
        .write(BRIEF)
        .then(
          () => null,
          (error: unknown) => error,
        );

    const refused = await said(() => Promise.resolve(answer({ stop_reason: 'refusal' })));
    expect(refused).toBeInstanceOf(CheatSheetWriterError);
    expect(refused).toHaveProperty(
      'message',
      'Claude declined to write this cheat sheet. Try describing the call differently.',
    );
    expect(await said(() => Promise.resolve(answer({ stop_reason: 'max_tokens' })))).toHaveProperty(
      'message',
      'Claude ran out of room writing this cheat sheet. Try again.',
    );
    expect(
      await said(() => Promise.resolve(answer({ json: { ...sheetDraft, close: [] } }))),
    ).toHaveProperty('message', expect.stringContaining('missing its opener, questions or close'));
    expect(await said(() => Promise.reject(new APIUserAbortError()))).toHaveProperty(
      'message',
      'Claude took more than 2 minutes writing this cheat sheet. Try again.',
    );
  });
});
