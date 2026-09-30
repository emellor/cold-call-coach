import { APIUserAbortError } from '@anthropic-ai/sdk';
import type {
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { RepNotesDraft } from '@ccc/contracts';
import { RepNotesError } from '@ccc/core';
import { describe, expect, it } from 'vitest';
import { readPriceTable } from '../prices.ts';
import type { CreatingMessages } from '../prospects/writer.ts';
import { testCatalog } from '../test/catalog.ts';
import { type RepNotesInput, REP_NOTES_EFFORT, claudeRepNoter } from './noter.ts';

const prices = await readPriceTable();
const scenario = testCatalog.scenarios.find((s) => s.id === 'medium-finance-director')!;

const input: RepNotesInput = {
  scenario,
  product: testCatalog.product,
  turns: [
    { speaker: 'prospect', text: 'Claire Hughes.' },
    {
      speaker: 'rep',
      text: "Hi Claire, it's Sam from WattGuard. Have I caught you at a bad time?",
    },
    { speaker: 'prospect', text: 'Go on.' },
    { speaker: 'rep', text: 'Would Tuesday at ten work for twenty minutes?' },
  ],
  outcome: 'meeting_booked',
  outcomeReason: 'Tuesday at 10am',
};

const draft: RepNotesDraft = {
  notes: [
    { turn: 2, technique: 'Permission opener', note: 'She says yes before any pitch.' },
    { turn: 3, technique: 'Her line', note: 'Not his: dropped.' },
    { turn: 4, technique: 'Specific close', note: 'A day and time is easy to agree to.' },
  ],
  summary: 'Sam asked first and closed on a time.',
  lessons: ['Ask first.', 'Close on a specific slot.'],
};

function answer(patch: Partial<BetaMessage> & { json?: unknown } = {}) {
  const { json = draft, ...rest } = patch;
  return {
    model: 'claude-opus-5-5',
    stop_reason: 'end_turn',
    usage: { input_tokens: 1_000, output_tokens: 1_500, cache_read_input_tokens: 0 },
    content: [{ type: 'text', text: JSON.stringify(json) }],
    ...rest,
  } as BetaMessage;
}

function noterWith(reply: () => Promise<BetaMessage> = () => Promise.resolve(answer())) {
  const sent: MessageCreateParamsNonStreaming[] = [];
  const messages: CreatingMessages = {
    create: (params) => {
      sent.push(params);
      return reply();
    },
  };
  return { note: claudeRepNoter({ messages, model: 'claude-opus-5-5', prices }), sent };
}

describe('claudeRepNoter', () => {
  it("annotates Sam's lines in one structured-output request, with the shared prompt cached", async () => {
    const { note, sent } = noterWith();
    const outcome = await note(input);
    const [params] = sent;
    expect(params).toMatchObject({
      model: 'claude-opus-5-5',
      output_config: { effort: REP_NOTES_EFFORT, format: { type: 'json_schema' } },
      fallbacks: 'default',
    });
    expect(params).not.toHaveProperty('thinking');
    expect(params?.system).toEqual([
      expect.objectContaining({ type: 'text', cache_control: { type: 'ephemeral' } }),
    ]);
    expect(params?.messages[0]?.content as string).toContain(
      "Write the notes for Sam's lines: turns 2, 4.",
    );

    expect(outcome.notes.notes.map((n) => n.turn)).toEqual([2, 4]);
    expect(outcome.notes.summary).toBe('Sam asked first and closed on a time.');
    // 1,000 × $4 + 1,500 × $20, per million tokens.
    expect(outcome.costUsd).toBeCloseTo(0.034, 6);
  });

  it('fails with words the rep can act on', async () => {
    const cases: Array<[() => Promise<BetaMessage>, string]> = [
      [() => Promise.resolve(answer({ stop_reason: 'refusal' })), 'declined'],
      [() => Promise.resolve(answer({ stop_reason: 'max_tokens' })), 'ran out of room'],
      [() => Promise.resolve(answer({ json: { notes: 'nope' } })), 'malformed'],
      [() => Promise.reject(new APIUserAbortError()), 'more than 2 minutes'],
      [
        () => Promise.resolve(answer({ json: { ...draft, notes: [draft.notes[1]] } })),
        "didn't match any of Sam's lines",
      ],
    ];
    for (const [reply, words] of cases) {
      const { note } = noterWith(reply);
      const failure = note(input);
      await expect(failure).rejects.toThrow(RepNotesError);
      await expect(failure).rejects.toThrow(words);
    }
  });
});
