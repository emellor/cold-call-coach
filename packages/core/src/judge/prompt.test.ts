import { describe, expect, it } from 'vitest';
import { initialState } from '../prospect/stateEngine.ts';
import { product, scenario } from '../test/fixtures.ts';
import { buildJudgeSystemPrompt, buildJudgeUserPrompt } from './prompt.ts';

describe('buildJudgeSystemPrompt', () => {
  const prompt = buildJudgeSystemPrompt(scenario, product);

  it('gives the judge the product and her private facts by key', () => {
    expect(prompt).toContain(`- WattGuard: ${product.oneLiner}`);
    expect(prompt).toContain('- Value: per-site energy visibility; anomaly alerts;');
    expect(prompt).toContain(
      '- pain_1: energy bills up about 40% in two years and the board wants answers',
    );
    expect(prompt).toContain("- pain_2: no per-site breakdown, only the supplier's monthly bill");
    expect(prompt).toContain('- current_solution: ');
    expect(prompt).toContain('- decision_process: ');
    expect(prompt).toContain('- timing: budget planning starts in January');
    expect(prompt).not.toContain('pain_3');
  });

  it('defines every signal it asks for', () => {
    for (const signal of [
      'askedPermission',
      'gaveRelevantReason',
      'askedOpenQuestion',
      'followedUp',
      'acknowledgedObjection',
      'pitchedFeatures',
      'ignoredHerPoint',
      'pushy',
      'rude',
      'askedForMeeting',
      'proposedSpecificTime',
      'revealEarned',
      'stage',
      'tip',
    ]) {
      expect(prompt).toContain(`- ${signal}: `);
    }
  });
});

describe('buildJudgeUserPrompt', () => {
  const turns = [
    { speaker: 'prospect', text: 'Claire Hughes.' },
    { speaker: 'rep', text: 'Hi Claire, Sam from WattGuard. Got thirty seconds?' },
    { speaker: 'prospect', text: 'Go on.' },
    { speaker: 'rep', text: 'Finance directors tell me energy bills are the new rent.' },
    { speaker: 'prospect', text: 'Right, and', interrupted: true },
    { speaker: 'rep', text: 'How are you tracking energy across your three sites?' },
    { speaker: 'prospect', text: 'Why do you ask?' },
    { speaker: 'rep', text: 'Because most of our customers could not see it per site.' },
  ] as const;

  it('shows the last six turns ending on the rep turn to judge, marked LATEST', () => {
    const prompt = buildJudgeUserPrompt({ turns, state: initialState(scenario) });
    expect(prompt).not.toContain('Got thirty seconds');
    expect(prompt).toContain('Prospect: Go on.');
    expect(prompt).toContain('Prospect: Right, and [cut off by the rep]');
    expect(prompt).toContain(
      'LATEST Rep: Because most of our customers could not see it per site.',
    );
    expect(prompt.trimEnd().endsWith('Judge the LATEST rep turn.')).toBe(true);
  });

  it('judges the last rep turn even if she has already started replying', () => {
    const prompt = buildJudgeUserPrompt({
      turns: [...turns, { speaker: 'prospect', text: 'Hmm.' }],
      state: initialState(scenario),
    });
    expect(prompt).toContain('LATEST Rep: Because most of our customers');
    expect(prompt).not.toContain('Hmm.');
  });

  it('states her current numbers and what is already revealed', () => {
    const prompt = buildJudgeUserPrompt({
      turns,
      state: { turn: 3, interest: 42.4, patience: 51, painsRevealed: ['pain_2'] },
    });
    expect(prompt).toContain('interest 42/100, patience 51/100');
    expect(prompt).toContain('Private facts already revealed: pain_2.');
  });

  it('needs a rep turn to judge', () => {
    expect(() =>
      buildJudgeUserPrompt({
        turns: [{ speaker: 'prospect', text: 'Hello?' }],
        state: initialState(scenario),
      }),
    ).toThrow('needs a rep turn');
  });
});
