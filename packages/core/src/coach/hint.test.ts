import { describe, expect, it } from 'vitest';
import { product, scenario } from '../test/fixtures.ts';
import { HINT_WINDOW_TURNS, buildHintSystemPrompt, buildHintUserPrompt, helpFrom } from './hint.ts';
import { stageStatuses } from './stages.ts';

describe('buildHintSystemPrompt', () => {
  const prompt = buildHintSystemPrompt(scenario, product);

  it('knows what the rep sells and who they are calling, and asks for the words, why and a follow-up', () => {
    expect(prompt).toContain(product.name);
    expect(prompt).toContain('Claire Hughes, Finance Director at Harrow & Finch Logistics');
    expect(prompt).toContain(scenario.winCondition);
    expect(prompt).toContain('- say: the exact words for the rep to say next');
    expect(prompt).toContain('- why:');
    expect(prompt).toContain('- ifPushback:');
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
  const turns = Array.from({ length: 16 }, (_, i) => ({
    speaker: i % 2 ? ('rep' as const) : ('prospect' as const),
    text: `line ${i}`,
    interrupted: i === 14,
  }));

  it('shows the latest turns, marking a reply the rep cut off', () => {
    const prompt = buildHintUserPrompt(turns);
    expect(prompt).not.toContain('line 3\n');
    expect(prompt).toContain(`Prospect: line ${16 - HINT_WINDOW_TURNS}`);
    expect(prompt).toContain('Prospect: line 14 [cut off by the rep]');
    expect(prompt).toMatch(/Rep: line 15\n\nWhat should the rep say next\?$/);
  });

  it('says where the call has got to, so the help fits this point of it', () => {
    const prompt = buildHintUserPrompt(turns, stageStatuses(['opener', 'reason', 'discovery']));
    expect(prompt).toMatch(
      /^Where the call has got to:\n- Opener: done\n- Reason for the call: done\n- Discovery: active\n- Objections: pending\n- Next step \(the meeting\): pending\n\nThe call so far/,
    );
  });

  it('copes with a call where nothing has been said', () => {
    expect(buildHintUserPrompt([])).toContain('(Nothing has been said yet.)');
  });
});

describe('helpFrom', () => {
  it('unquotes the words and keeps the reason and the follow-up', () => {
    expect(
      helpFrom({
        say: '  "What does month end look like for you?" ',
        why: ' Discovery: an open question about her process. ',
        ifPushback: '“Fair enough. What would make ten minutes worth it?”',
      }),
    ).toEqual({
      say: 'What does month end look like for you?',
      why: 'Discovery: an open question about her process.',
      ifPushback: 'Fair enough. What would make ten minutes worth it?',
    });
  });

  it('drops a blank follow-up, and gives nothing without the words or the reason', () => {
    expect(helpFrom({ say: "What's driving that?", why: 'Discovery.', ifPushback: ' ' })).toEqual({
      say: "What's driving that?",
      why: 'Discovery.',
    });
    expect(helpFrom({ say: '""', why: 'Discovery.', ifPushback: 'x' })).toBeNull();
    expect(helpFrom({ say: 'Hello?', why: '', ifPushback: 'x' })).toBeNull();
    expect(helpFrom(null)).toBeNull();
  });
});
