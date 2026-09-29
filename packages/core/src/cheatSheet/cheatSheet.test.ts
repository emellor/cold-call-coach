import { type CheatSheetDraft, RubricSpec } from '@ccc/contracts';
import { describe, expect, it } from 'vitest';
import { product } from '../test/fixtures.ts';
import {
  CheatSheetError,
  buildCheatSheetSystemPrompt,
  buildCheatSheetUserPrompt,
  cheatSheetFrom,
} from './prompt.ts';

const criterion = (key: string, name: string) => ({
  key,
  name,
  goodLooksLike: `${name} done well`,
  anchors: { '1': `${name}: poor`, '3': `${name}: fair`, '5': `${name}: 10/10` },
});

const rubric = RubricSpec.parse({
  id: 'cold-call-v1',
  version: 1,
  title: 'Cold call',
  criteria: [
    criterion('opener', 'Opener'),
    criterion('reason', 'Reason for call'),
    criterion('discovery', 'Discovery'),
    criterion('objections', 'Objections'),
    criterion('next_step', 'Next step'),
    criterion('delivery', 'Delivery'),
  ],
});

const reply = (they: string, you: string) => ({ they, you });

const draft = (patch: Partial<CheatSheetDraft> = {}): CheatSheetDraft => ({
  title: ' Sarah Patel, Carewell ',
  goal: ' A 20-minute call on site-by-site monitoring ',
  opener: [' Hi Sarah, it’s Sam from WattGuard. ', '', 'Can I have thirty seconds?', 'Third'],
  reason: ' Care groups tell me the gas bill doubled and nobody knows which home. ',
  questions: [
    'How do you see energy by home today?',
    ' ',
    'What does the board ask?',
    'Q3',
    'Q4',
    'Q5',
    'Q6',
    'Q7',
  ],
  theirQuestions: [reply('What is it?', 'Monitoring for every site.'), reply(' ', 'dropped')],
  objections: [
    reply('Send me an email', 'Happy to: what should it cover?'),
    reply('We have a broker', 'Good: brokers do price. Who looks at use?'),
  ],
  valueLines: [
    reply('Bills up', 'We show which site.'),
    reply('A', 'B'),
    reply('C', 'D'),
    reply('E', 'F'),
  ],
  close: ['Would Thursday at ten work for twenty minutes?'],
  voicemail: ' Sarah, Sam from WattGuard, about the winter gas bills. ',
  ...patch,
});

describe('the cheat sheet prompt', () => {
  it('sets the product, the 10/10 scorecard and what goes on the page, the same for every sheet', () => {
    const system = buildCheatSheetSystemPrompt({ product, rubric });
    expect(system).toContain(`The rep sells WattGuard: ${product.oneLiner}`);
    expect(system).toContain(`The goal of a call: ${product.callGoal}, unless the profile`);
    expect(system).toContain('- Discovery: Discovery: 10/10');
    expect(system).toContain('- objections: four to six objections');
    expect(system).toContain('readable in two seconds');
    // The profile goes in the user turn, so this prompt caches across sheets.
    expect(system).not.toContain('<profile>');
  });

  it('gives the rep’s profile as they wrote it', () => {
    expect(buildCheatSheetUserPrompt({ brief: '  Sarah Patel, Carewell.  ' })).toContain(
      '<profile>\nSarah Patel, Carewell.\n</profile>',
    );
  });
});

describe('cheatSheetFrom', () => {
  it('trims every line, drops blank ones and caps each list at a page', () => {
    const sheet = cheatSheetFrom(draft());
    expect(sheet.title).toBe('Sarah Patel, Carewell');
    expect(sheet.opener).toEqual([
      'Hi Sarah, it’s Sam from WattGuard.',
      'Can I have thirty seconds?',
    ]);
    expect(sheet.questions).toHaveLength(6);
    expect(sheet.theirQuestions).toEqual([reply('What is it?', 'Monitoring for every site.')]);
    expect(sheet.valueLines).toHaveLength(3);
    expect(sheet.voicemail).toBe('Sarah, Sam from WattGuard, about the winter gas bills.');
  });

  it('refuses a sheet without an opener, questions or a close', () => {
    expect(() => cheatSheetFrom(draft({ opener: [' '] }))).toThrow(CheatSheetError);
    expect(() => cheatSheetFrom(draft({ questions: ['One?'] }))).toThrow(CheatSheetError);
    expect(() => cheatSheetFrom(draft({ close: [] }))).toThrow(/opener, questions or close/);
  });
});
