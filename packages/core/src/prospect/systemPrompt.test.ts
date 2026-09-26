import { describe, expect, it } from 'vitest';
import { clone, product, scenario } from '../test/fixtures.ts';
import { buildProspectSystemPrompt, languageName } from './systemPrompt.ts';

describe('buildProspectSystemPrompt', () => {
  const prompt = buildProspectSystemPrompt(scenario);

  it('fills the PLAN.md §6.2 skeleton from the scenario', () => {
    expect(prompt).toMatch(
      /^You are Claire Hughes, Finance Director at Harrow & Finch Logistics \(3 warehouses in the Midlands, 240 staff\)\. You're at work/,
    );
    expect(prompt).toContain("How you speak: clipped, dry humour, says 'right' and 'look'.");
    expect(prompt).toContain('British English spelling and idiom.');
    expect(prompt).toContain(
      'Personality: direct, numbers-first, sceptical of vendors, hates wasted time.',
    );
    expect(prompt).toContain(
      "- Pains: energy bills up about 40% in two years and the board wants answers; no per-site breakdown, only the supplier's monthly bill",
    );
    expect(prompt).toContain("- Current solution: the supplier's portal plus a spreadsheet");
    expect(prompt).toContain('- Decision process: signs off anything under £20k');
    expect(prompt).toContain('- Timing: budget planning starts in January');
    expect(prompt).toContain(
      "when they fit: I'm about to go into a meeting; Just send me an email; We already get reports from our supplier; What's this going to cost?",
    );
  });

  it('carries the rules for the note and both tools', () => {
    expect(prompt).toContain(
      'Each turn you receive a private note about your patience and interest',
    );
    expect(prompt).toContain('Confirm it out loud, then call agree_to_meeting.');
    expect(prompt).toContain('To end the call, say a brief goodbye first, then call end_call.');
  });

  it('never tells her what the caller sells', () => {
    for (const detail of [
      product.name,
      product.oneLiner,
      ...product.valuePoints,
      product.callGoal,
    ]) {
      expect(prompt).not.toContain(detail);
    }
  });

  it('is identical every time for the same scenario, so it caches', () => {
    expect(buildProspectSystemPrompt(clone(scenario))).toBe(prompt);
  });
});

describe('languageName', () => {
  it('names common English locales and falls back to the code', () => {
    expect(languageName('en-GB')).toBe('British English');
    expect(languageName('en-US')).toBe('American English');
    expect(languageName('fr-FR')).toBe('fr-FR');
  });
});
