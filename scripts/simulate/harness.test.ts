// The harness itself, with Claude faked: the rep reads from a script, the judge
// scores by keywords, and the prospect follows her note. What's under test is
// the loop: the one-turn lag, the meeting rule, and how a call stops.
import { readFileSync } from 'node:fs';
import { ProductSpec, ScenarioSpec, type JudgeResult } from '@ccc/contracts';
import { describe, expect, it } from 'vitest';
import type { BetaMessage } from '../../apps/agent/src/claude/client.ts';
import { PERSONAS } from './personas.ts';
import { type SimMessages, simulateCall, speakingSeconds } from './harness.ts';

const load = (file: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../scenarios/${file}`, import.meta.url), 'utf8'));
const scenario = ScenarioSpec.parse(load('medium-finance-director.json'));
const product = ProductSpec.parse(load('product.json'));
const models = {
  rep: 'claude-opus-5',
  prospect: 'claude-opus-5',
  prospectEffort: 'low' as const,
  coach: 'claude-opus-5',
  coachEffort: 'low' as const,
};

const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0 };

/** The text of a message the harness sent (always a plain string here). */
const textOf = (message: { content: unknown } | undefined): string =>
  typeof message?.content === 'string' ? message.content : '';

function signalsFor(line: string): JudgeResult['signals'] {
  return {
    askedPermission: /thirty seconds/i.test(line),
    gaveRelevantReason: /energy bills/i.test(line),
    askedOpenQuestion: /^how\b/i.test(line),
    followedUp: /^how\b/i.test(line),
    acknowledgedObjection: false,
    pitchedFeatures: /features/i.test(line),
    ignoredHerPoint: /features/i.test(line),
    pushy: false,
    rude: false,
    askedForMeeting: /tuesday at 10/i.test(line),
    proposedSpecificTime: /tuesday at 10/i.test(line),
  };
}

/**
 * A fake Claude. The rep says `lines` in order. The prospect agrees whenever a
 * time is proposed, whatever her note says (so the meeting rule is what stops a
 * bad booking), and says goodbye with end_call when her note says she's done.
 */
function fakeClaude(lines: string[]) {
  const script = [...lines];
  const seen = { repCalls: 0, notes: [] as string[] };
  const text = (t: string) => ({ type: 'text', text: t });
  const messages: SimMessages = {
    create: () => {
      seen.repCalls += 1;
      return Promise.resolve({
        content: [text(script.shift() ?? 'Anyway.')],
        usage,
        stop_reason: 'end_turn',
      } as unknown as BetaMessage);
    },
    parse: (params) => {
      const user = textOf(params.messages.at(-1));
      const latest = /LATEST Rep: (.*)/.exec(user)?.[1] ?? '';
      const result: JudgeResult = {
        stage: 'other',
        signals: signalsFor(latest),
        revealEarned: null,
        tip: null,
      };
      return Promise.resolve({
        model: params.model,
        stop_reason: 'end_turn',
        usage,
        content: [],
        parsed_output: result,
      } as unknown as BetaMessage & { parsed_output: unknown });
    },
    stream: (params) => {
      const note = textOf(params.messages.at(-1));
      seen.notes.push(note);
      const caller = textOf(params.messages.at(-2));
      const content: Array<Record<string, unknown>> = [];
      let say = 'Go on.';
      if (note.includes('call end_call')) {
        say = "Right, I've heard enough. Goodbye.";
        content.push({
          type: 'tool_use',
          id: 't1',
          name: 'end_call',
          input: { reason: 'Waste of time' },
        });
      } else if (/tuesday at 10/i.test(caller)) {
        say = 'Fine, Tuesday at ten.';
        content.push({
          type: 'tool_use',
          id: 't2',
          name: 'agree_to_meeting',
          input: { when: 'Tuesday at 10am' },
        });
      }
      return {
        async *[Symbol.asyncIterator]() {
          yield await Promise.resolve({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: say },
          } as never);
        },
        finalMessage: () =>
          Promise.resolve({
            model: params.model,
            stop_reason: content.length ? 'tool_use' : 'end_turn',
            usage,
            content: [text(say), ...content],
          } as unknown as BetaMessage),
      };
    },
  };
  return { messages, seen };
}

const RAMBLE = `Our features ${'and more features '.repeat(60)}`;

describe('simulateCall', () => {
  it('a good rep books the meeting once she is interested, then stops', async () => {
    const { messages } = fakeClaude([
      "Hi Claire, it's Sam at WattGuard. Have you got thirty seconds?",
      'Finance directors tell me energy bills are the line the board keeps asking about.',
      'How do you see energy use across the three warehouses today?',
      'How does that land at month end?',
      'How is the board reacting to the increase?',
      'Could we take twenty minutes, say Tuesday at 10am?',
      'Should not be reached.',
    ]);
    const result = await simulateCall({
      scenario,
      product,
      persona: PERSONAS.good,
      messages,
      models,
      maxTurns: 20,
    });
    expect(result.outcome).toBe('meeting_booked');
    expect(result.detail).toBe('Tuesday at 10am');
    expect(result.turns).toHaveLength(6);
    expect(result.turns.map((t) => t.judged?.after.interest)).toEqual([20, 30, 42, 54, 66, 66]);
    expect(result.usage.calls).toBe(18); // rep + prospect + judge, six times
  });

  it("a rambling, pushy rep's time never books: she runs out of patience and hangs up", async () => {
    const { messages, seen } = fakeClaude([
      `${RAMBLE} How about Tuesday at 10am?`,
      `${RAMBLE} Tuesday at 10am then?`,
      `${RAMBLE} Tuesday at 10am?`,
    ]);
    const result = await simulateCall({
      scenario,
      product,
      persona: PERSONAS.terrible,
      messages,
      models,
      maxTurns: 20,
    });
    expect(result.outcome).toBe('hung_up_by_prospect');
    expect(result.detail).toBe('Waste of time');
    // She agreed twice, but the meeting rule refused both: interest never reached 65.
    expect(result.turns.slice(0, 2).map((t) => t.actions.map((a) => a.type))).toEqual([
      ['agree_to_meeting'],
      ['agree_to_meeting'],
    ]);
    expect(result.turns).toHaveLength(3);
    expect(result.final.patience).toBe(0);
    // One-turn lag: the goodbye note arrives with the reply after the judgement that emptied her patience.
    expect(seen.notes[2]).toContain('call end_call');
    expect(seen.notes[1]).not.toContain('call end_call');
  });

  it('stops without a decision after the turn limit', async () => {
    const { messages } = fakeClaude([]);
    const result = await simulateCall({
      scenario: { ...scenario, state: { ...scenario.state, patienceDecayPerTurn: 0 } },
      product,
      persona: PERSONAS.good,
      messages,
      models,
      maxTurns: 3,
    });
    expect(result.outcome).toBe('no_decision');
    expect(result.turns).toHaveLength(3);
  });
});

describe('speakingSeconds', () => {
  it('assumes 150 words a minute', () => {
    expect(speakingSeconds('one two three four five')).toBe(2);
    expect(speakingSeconds(RAMBLE)).toBeGreaterThan(45);
  });
});

describe('PERSONAS', () => {
  it('brief both reps on the product and the prospect, and nothing private', () => {
    for (const persona of Object.values(PERSONAS)) {
      const system = persona.system(scenario, product);
      expect(system).toContain('WattGuard');
      expect(system).toContain('Claire Hughes, Finance Director at Harrow & Finch Logistics');
      for (const pain of scenario.prospect.hidden.pains) expect(system).not.toContain(pain);
    }
  });
});
