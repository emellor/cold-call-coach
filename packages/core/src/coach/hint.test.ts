import { describe, expect, it } from 'vitest';
import { product, scenario } from '../test/fixtures.ts';
import {
  HINT_WINDOW_TURNS,
  buildHintSystemPrompt,
  buildHintUserPrompt,
  hintSuggestions,
} from './hint.ts';

describe('buildHintSystemPrompt', () => {
  const prompt = buildHintSystemPrompt(scenario, product);

  it('knows what the rep sells and who they are calling', () => {
    expect(prompt).toContain(product.name);
    expect(prompt).toContain('Claire Hughes, Finance Director at Harrow & Finch Logistics');
    expect(prompt).toContain(scenario.winCondition);
    expect(prompt).toContain('exactly three different lines');
  });

  it('never sees her private facts, objections or hidden state', () => {
    const { hidden, objections, companyFacts } = scenario.prospect;
    for (const secret of [
      ...hidden.pains,
      hidden.currentSolution,
      hidden.decisionProcess,
      hidden.timing,
      ...objections,
      companyFacts,
    ]) {
      expect(prompt).not.toContain(secret);
    }
    expect(prompt).not.toMatch(/patience|interest \d/i);
  });
});

describe('buildHintUserPrompt', () => {
  it('shows the latest turns, marking a reply the rep cut off', () => {
    const turns = Array.from({ length: 12 }, (_, i) => ({
      speaker: i % 2 ? ('rep' as const) : ('prospect' as const),
      text: `line ${i}`,
      interrupted: i === 10,
    }));
    const prompt = buildHintUserPrompt(turns);
    expect(prompt).not.toContain('line 3\n');
    expect(prompt).toContain(`Prospect: line ${12 - HINT_WINDOW_TURNS}`);
    expect(prompt).toContain('Prospect: line 10 [cut off by the rep]');
    expect(prompt).toMatch(/Rep: line 11\n\nSuggest three lines/);
  });

  it('copes with a call where nothing has been said', () => {
    expect(buildHintUserPrompt([])).toContain('(Nothing has been said yet.)');
  });
});

describe('hintSuggestions', () => {
  it('trims, unquotes, drops blanks and repeats, and keeps three', () => {
    expect(
      hintSuggestions([
        '  "What does month end look like for you?" ',
        '',
        'what does  month end look like for you?',
        '“Fair enough. What would make it worth ten minutes?”',
        'Could we look at Tuesday at ten?',
        'A fourth line.',
      ]),
    ).toEqual([
      'What does month end look like for you?',
      'Fair enough. What would make it worth ten minutes?',
      'Could we look at Tuesday at ten?',
    ]);
  });

  it('keeps apostrophes inside a line', () => {
    expect(hintSuggestions(["What's driving that?"])).toEqual(["What's driving that?"]);
  });
});
