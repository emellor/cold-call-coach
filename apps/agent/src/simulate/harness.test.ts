// The harness itself, with Claude faked: the rep reads from a script, the judge
// scores by keywords, and the prospect follows her note. What's under test is
// the loop: the one-turn lag, the meeting rule, and how a call stops.
import { readFileSync } from 'node:fs';
import { ProductSpec, ScenarioSpec } from '@ccc/contracts';
import { describe, expect, it } from 'vitest';
import { fakeClaude } from '../test/fakeClaude.ts';
import { PERSONAS } from './personas.ts';
import { simulateCall, speakingSeconds } from './harness.ts';

const load = (file: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../../scenarios/${file}`, import.meta.url), 'utf8'));
const scenario = ScenarioSpec.parse(load('medium-finance-director.json'));
const product = ProductSpec.parse(load('product.json'));
const models = {
  rep: 'claude-opus-5',
  prospect: 'claude-opus-5',
  prospectEffort: 'low' as const,
  coach: 'claude-opus-5',
  coachEffort: 'low' as const,
};

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
