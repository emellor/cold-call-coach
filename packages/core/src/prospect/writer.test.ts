import { type ProspectDraft, VOICE_ID_PLACEHOLDER } from '@ccc/contracts';
import { describe, expect, it } from 'vitest';
import { hardScenario, product, scenario } from '../test/fixtures.ts';
import {
  ProspectDraftError,
  buildProspectWriterSystemPrompt,
  buildProspectWriterUserPrompt,
  prospectId,
  scenarioFromDraft,
} from './writer.ts';

const draft: ProspectDraft = {
  title: ' Energy broker with an in-house dev team ',
  difficulty: 'hard',
  locale: 'en-GB',
  prospect: {
    name: 'Rachel Byrne',
    role: 'Operations Director',
    company: 'Voltline Energy Partners',
    companyFacts: 'A mid-sized energy broker in Leeds: 60 staff, 900 business clients',
    personality: 'blunt and hard to impress; proud of what her developers have built',
    speakingStyle: "fast and flat; says 'we've got that covered' and 'what's the catch?'",
    openingLine: 'Voltline, Rachel speaking.',
    hidden: {
      pains: [
        ' clients keep asking for site-level reporting her team never finishes ',
        '',
        'ESOS deadlines swamp her analysts every cycle',
        'renewals season',
        'a fourth pain',
      ],
      currentSolution: 'a home-grown portal her developers maintain',
      decisionProcess: 'she and the MD decide together; anything over £30k goes to the board',
      timing: 'the portal rebuild is scoped for next quarter',
    },
    objections: [
      'Our developers could build that in a month',
      'We are a broker: energy data is our business',
      '',
      'Send me something',
      'What does it cost?',
      "I've got a call in two minutes",
      'Sixth',
    ],
  },
  voice: { hint: 'Northern English woman in her forties, brisk', speed: 'fast' },
};

describe('buildProspectWriterSystemPrompt', () => {
  const voices = [
    { id: 'voice-1', name: 'Harriet', description: 'Brisk British woman, forties' },
    { id: 'voice-2', name: 'Maeve', description: 'Warm Irish woman' },
  ];
  const prompt = buildProspectWriterSystemPrompt({
    product,
    examples: [scenario, hardScenario],
    voices,
  });

  it('knows the product, and shows the shipped prospects as examples', () => {
    expect(prompt).toContain(`- WattGuard: ${product.oneLiner}`);
    expect(prompt).toContain(
      `- "Busy finance director" (medium, en-GB): ${JSON.stringify(scenario.prospect)}`,
    );
    expect(prompt).toContain(`"${hardScenario.title}" (hard, en-GB)`);
  });

  it('keeps her a woman, winnable, and in character', () => {
    expect(prompt).toContain('She is a woman');
    expect(prompt).toContain('At least one pain must be something WattGuard genuinely helps with');
    expect(prompt).toContain('"very tough to sell to" is hard');
    expect(prompt).toContain('never mention WattGuard');
  });

  it('lists the voices to choose from, or none', () => {
    expect(prompt).toContain('- voice-1: Harriet. Brisk British woman, forties');
    expect(prompt).toContain('Pick one whose accent matches her locale');
    expect(
      buildProspectWriterSystemPrompt({ product, examples: [scenario], voices: [] }),
    ).not.toContain('voiceId');
  });

  it('quotes the description in the user prompt', () => {
    expect(buildProspectWriterUserPrompt('  A tough broker.  ')).toBe(
      'The rep\'s description of her:\n"""\nA tough broker.\n"""\n\nWrite this prospect.',
    );
  });
});

describe('prospectId', () => {
  it('makes a kebab-case id from her name', () => {
    expect(prospectId('Rachel Byrne', '4f2a9c')).toBe('rachel-byrne-4f2a9c');
    expect(prospectId("  Siobhán O'Connor-Díaz ", 'a1')).toBe('siobhan-o-connor-diaz-a1');
    expect(prospectId('李', 'b2')).toBe('prospect-b2');
  });
});

describe('scenarioFromDraft', () => {
  const templates = [scenario, hardScenario];

  it('takes the thresholds, win condition and rubric from the shipped scenario of her difficulty', () => {
    const spec = scenarioFromDraft(draft, { id: 'rachel-byrne-4f2a9c', templates });
    expect(spec).toMatchObject({
      id: 'rachel-byrne-4f2a9c',
      version: 1,
      title: 'Energy broker with an in-house dev team',
      difficulty: 'hard',
      locale: 'en-GB',
      state: hardScenario.state,
      winCondition: hardScenario.winCondition,
      rubricId: hardScenario.rubricId,
    });
    expect(spec.prospect.name).toBe('Rachel Byrne');
  });

  it('keeps at most three pains and five objections, without blanks', () => {
    const { hidden, objections } = scenarioFromDraft(draft, { id: 'x-1', templates }).prospect;
    expect(hidden.pains).toEqual([
      'clients keep asking for site-level reporting her team never finishes',
      'ESOS deadlines swamp her analysts every cycle',
      'renewals season',
    ]);
    expect(objections).toHaveLength(5);
    expect(objections).not.toContain('');
  });

  it('uses the chosen voice, or the placeholder that falls back to CARTESIA_VOICE_ID', () => {
    expect(
      scenarioFromDraft({ ...draft, voiceId: 'voice-1' }, { id: 'x-1', templates }).voice,
    ).toEqual({
      provider: 'cartesia',
      voiceId: 'voice-1',
      speed: 'fast',
      hint: 'Northern English woman in her forties, brisk',
    });
    expect(scenarioFromDraft(draft, { id: 'x-1', templates }).voice.voiceId).toBe(
      VOICE_ID_PLACEHOLDER,
    );
  });

  it('falls back to the first template when none shares her difficulty', () => {
    const easy = { ...draft, difficulty: 'easy' as const };
    expect(scenarioFromDraft(easy, { id: 'x-1', templates }).state).toEqual(scenario.state);
  });

  it('refuses a draft that is missing what a call needs', () => {
    const noPains = {
      ...draft,
      prospect: { ...draft.prospect, hidden: { ...draft.prospect.hidden, pains: [' '] } },
    };
    expect(() => scenarioFromDraft(noPains, { id: 'x-1', templates })).toThrow(ProspectDraftError);
    expect(() => scenarioFromDraft(noPains, { id: 'x-1', templates })).toThrow(
      'The prospect Claude wrote is incomplete: prospect.hidden.pains',
    );
    expect(() => scenarioFromDraft(draft, { id: 'Not Kebab', templates })).toThrow(
      ProspectDraftError,
    );
    expect(() => scenarioFromDraft(draft, { id: 'x-1', templates: [] })).toThrow(
      'There is no shipped scenario to base her on.',
    );
  });
});
