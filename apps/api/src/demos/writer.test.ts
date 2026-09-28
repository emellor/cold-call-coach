import { APIError, APIUserAbortError } from '@anthropic-ai/sdk';
import type {
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { DemoBriefDraft, DemoScriptDraft } from '@ccc/contracts';
import { DEMO_ANGLES } from '@ccc/core';
import { describe, expect, it, vi } from 'vitest';
import { readPriceTable } from '../prices.ts';
import type { CreatingMessages } from '../prospects/writer.ts';
import { testCatalog } from '../test/catalog.ts';
import { DEMO_WRITER_EFFORT, DemoWriterError, claudeDemoWriter } from './writer.ts';

const prices = await readPriceTable();
const scenario = testCatalog.scenarios.find((s) => s.id === 'medium-finance-director')!;
const angle = DEMO_ANGLES[0]!;

const line = (speaker: 'rep' | 'prospect', text: string, technique: string | null = null) => ({
  speaker,
  text,
  technique,
  note: technique ? `Why ${technique.toLowerCase()} works here.` : null,
});

const call = [
  line('prospect', scenario.prospect.openingLine),
  line('rep', 'Hi Claire, Sam at WattGuard. Thirty seconds?', 'Permission opener'),
  line('prospect', 'Thirty. Go.'),
  line('rep', 'How do you see energy site by site today?', 'Open question'),
  line('prospect', "We don't. One bill."),
  line('rep', 'What does that cost you at board time?', 'Cost question'),
  line('prospect', 'Hours.'),
  line('rep', 'Thursday at ten for twenty minutes?', 'Specific close'),
  line('prospect', 'Thursday at ten.'),
];

const draft: DemoScriptDraft = {
  lines: call,
  meeting: 'Thursday 10:00, 20-minute video call',
  title: 'The thirty-second opener',
  summary: 'Earns time, then asks.',
  lessons: ['Ask first.', 'Follow up.', 'Close on a time.'],
};

function answer(patch: Partial<BetaMessage> & { json?: unknown } = {}) {
  const { json = draft, ...rest } = patch;
  return {
    model: 'claude-opus-5',
    stop_reason: 'end_turn',
    usage: { input_tokens: 800, output_tokens: 3_000, cache_read_input_tokens: 1_500 },
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
  const write = claudeDemoWriter({
    messages,
    model: 'claude-opus-5',
    product: testCatalog.product,
    rubrics: testCatalog.rubrics,
    prices,
    logger,
  });
  return { write, sent, logger };
}

describe('claudeDemoWriter', () => {
  it('writes the whole call in one structured-output request, with the shared prompt cached', async () => {
    const { write, sent, logger } = writerWith();
    const demo = await write({ scenario, angle });

    expect(sent).toHaveLength(1);
    const [params] = sent;
    expect(params).toMatchObject({
      model: 'claude-opus-5',
      output_config: { effort: DEMO_WRITER_EFFORT, format: { type: 'json_schema' } },
    });
    expect(params?.system).toEqual([
      expect.objectContaining({ type: 'text', cache_control: { type: 'ephemeral' } }),
    ]);
    expect(params?.messages).toHaveLength(1);
    expect(params?.messages[0]?.content).toContain(`The rep's approach for this call: ${angle}`);
    expect(params?.messages[0]?.content).toContain(scenario.prospect.hidden.timing);

    expect(demo).toMatchObject({
      title: 'The thirty-second opener',
      meeting: 'Thursday 10:00, 20-minute video call',
      model: 'claude-opus-5',
    });
    expect(demo.lines).toHaveLength(9);
    expect(demo.lines[1]).toEqual(call[1]);
    // 800 × $5 + 1,500 × $0.50 + 3,000 × $25, per million tokens.
    expect(demo.costUsd).toBeCloseTo(0.07975, 6);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ lane: 'demo-writer', costUsd: demo.costUsd }),
      'claude usage',
    );
  });

  it('fails with words the rep can act on, and never tries again by itself', async () => {
    const said = (reply: () => Promise<BetaMessage>) => {
      const { write, sent } = writerWith(reply);
      return write({ scenario, angle }).then(
        () => ({ error: null, requests: sent.length }),
        (error: unknown) => ({ error, requests: sent.length }),
      );
    };

    const refused = await said(() => Promise.resolve(answer({ stop_reason: 'refusal' })));
    expect(refused.error).toBeInstanceOf(DemoWriterError);
    expect(refused.error).toHaveProperty(
      'message',
      'Claude declined to write this call. Retry it.',
    );
    expect(refused.requests).toBe(1);

    expect(
      (await said(() => Promise.resolve(answer({ stop_reason: 'max_tokens' })))).error,
    ).toHaveProperty('message', 'Claude ran out of room writing this call. Retry it.');
    expect(
      (
        await said(() =>
          Promise.resolve(answer({ content: [{ type: 'text', text: '{"lines":' }] } as never)),
        )
      ).error,
    ).toHaveProperty('message', "Claude's answer came back malformed. Retry it.");
    expect(
      (await said(() => Promise.resolve(answer({ json: { ...draft, lines: call.slice(0, 4) } }))))
        .error,
    ).toHaveProperty('message', expect.stringContaining('too short to study'));

    const broke = APIError.generate(
      400,
      {
        error: {
          type: 'invalid_request_error',
          message: 'Your credit balance is too low to access the Anthropic API.',
        },
      },
      'credit',
      new Headers(),
    );
    expect((await said(() => Promise.reject(broke))).error).toHaveProperty(
      'message',
      'Claude answered 400: Your credit balance is too low to access the Anthropic API.',
    );
    expect((await said(() => Promise.reject(new APIUserAbortError()))).error).toHaveProperty(
      'message',
      'Claude took more than 3 minutes writing this call. Retry it.',
    );
  });

  it("writes a call from the rep's brief, with whoever Claude made the prospect", async () => {
    const brief =
      'Tom Reid, head of estates at Carewell, 14 care homes in Yorkshire. Objective: a site visit.';
    const briefDraft: DemoBriefDraft = {
      ...draft,
      lines: call.slice(1),
      meeting: 'A site visit at the Harrogate home, Tuesday at 2pm',
      prospect: {
        name: 'Tom Reid',
        role: 'Head of Estates',
        company: 'Carewell',
        difficulty: 'hard',
        gender: 'male',
        locale: 'en-GB',
      },
    };
    const { write, sent } = writerWith(() => Promise.resolve(answer({ json: briefDraft })));
    const demo = await write({ brief });

    const [params] = sent;
    // The writer sends the user turn as one string.
    const content = params?.messages[0]?.content as string;
    expect(content).toContain(`<brief>\n${brief}\n</brief>`);
    expect(content).not.toContain("The rep's approach for this call");
    // The same cached system prompt as every other demo.
    const scenarioCall = writerWith();
    await scenarioCall.write({ scenario, angle });
    expect(params?.system).toEqual(scenarioCall.sent[0]?.system);
    const schema = JSON.stringify(params?.output_config?.format);
    expect(schema).toContain('"prospect"');
    expect(schema).toContain('"gender"');

    expect(demo.prospect).toEqual(briefDraft.prospect);
    expect(demo.meeting).toBe('A site visit at the Harrogate home, Tuesday at 2pm');
    // It started with the rep, so the prospect answers the phone first.
    expect(demo.lines[0]).toEqual({
      speaker: 'prospect',
      text: 'Hello?',
      technique: null,
      note: null,
    });
  });

  it('refuses a prospect whose rubric is not loaded, before spending anything', async () => {
    const { write, sent } = writerWith();
    await expect(write({ scenario: { ...scenario, rubricId: 'nope' }, angle })).rejects.toThrow(
      'The rubric "nope" is not loaded.',
    );
    expect(sent).toHaveLength(0);
  });
});
