import { type RepNotesDraft, RubricSpec } from '@ccc/contracts';
import { describe, expect, it } from 'vitest';
import { buildProspectMessages } from '../prospect/messages.ts';
import { product, scenario } from '../test/fixtures.ts';
import { CONNECTED_CUE, HER_SILENCE_CUE, buildRepMessages } from './messages.ts';
import {
  RepNotesError,
  buildRepNotesSystemPrompt,
  buildRepNotesUserPrompt,
  repNotesFrom,
} from './notes.ts';
import { expertPlaybook } from './playbook.ts';
import { buildRepSystemPrompt } from './systemPrompt.ts';

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

describe("Sam's system prompt", () => {
  const system = buildRepSystemPrompt({ scenario, product, rubric });

  it('knows who he is calling as a rep would: her name, role, company and public facts', () => {
    expect(system).toContain('You are Sam, an expert B2B sales rep at WattGuard');
    expect(system).toContain(
      "Who you're calling: Claire Hughes, Finance Director at Harrow & Finch Logistics. What you found out before calling: 3 warehouses in the Midlands, 240 staff.",
    );
    expect(system).toContain(
      'It is won when she agrees to a 20-minute call at a specific day and time.',
    );
    expect(system).toContain(expertPlaybook('WattGuard'));
    expect(system).toContain('- Opener: Opener: 10/10');
    expect(system).toContain('British English');
    expect(system).toContain('book_meeting');
    expect(system).toContain('end_call');
  });

  it('never sees what she keeps to herself, how she behaves, or her objections', () => {
    const { prospect } = scenario;
    const secrets = [
      ...prospect.hidden.pains,
      prospect.hidden.currentSolution,
      prospect.hidden.decisionProcess,
      prospect.hidden.timing,
      prospect.personality,
      prospect.speakingStyle,
      ...prospect.objections,
    ];
    for (const secret of secrets) expect(system).not.toContain(secret);
  });

  it('plays to the playbook alone when the rubric is missing', () => {
    const plain = buildRepSystemPrompt({ scenario, product });
    expect(plain).toContain(expertPlaybook('WattGuard'));
    expect(plain).not.toContain('scorecard');
  });

  it('follows the same playbook as the written demos', () => {
    expect(expertPlaybook('WattGuard')).toContain(
      'Ties one relevant point about WattGuard to a problem only after she has named it',
    );
  });
});

describe("Sam's conversation", () => {
  it('has her lines as the user and his as the assistant, opening on her greeting', () => {
    expect(
      buildRepMessages([
        { speaker: 'prospect', text: 'Claire Hughes.' },
        { speaker: 'rep', text: "Hi Claire, it's Sam from WattGuard." },
        { speaker: 'prospect', text: 'Go on.' },
      ]),
    ).toEqual([
      { role: 'user', content: 'Claire Hughes.' },
      { role: 'assistant', content: "Hi Claire, it's Sam from WattGuard." },
      { role: 'user', content: 'Go on.' },
    ]);
  });

  it('opens on the connection when Sam spoke first, and stands in for her silence after him', () => {
    expect(buildRepMessages([{ speaker: 'rep', text: 'Hello? Is that Claire?' }])).toEqual([
      { role: 'user', content: CONNECTED_CUE },
      { role: 'assistant', content: 'Hello? Is that Claire?' },
      { role: 'user', content: HER_SILENCE_CUE },
    ]);
  });

  it('marks a line of his she talked over, and joins two of hers in a row', () => {
    expect(
      buildRepMessages([
        { speaker: 'prospect', text: 'Claire Hughes.' },
        { speaker: 'rep', text: 'Hi Claire, I was hoping', interrupted: true },
        { speaker: 'prospect', text: 'Sorry, who is this?' },
        { speaker: 'prospect', text: 'Are you selling something?' },
      ]),
    ).toEqual([
      { role: 'user', content: 'Claire Hughes.' },
      { role: 'assistant', content: 'Hi Claire, I was hoping—' },
      { role: 'user', content: 'Sorry, who is this? Are you selling something?' },
    ]);
  });

  it('leaves her conversation on a normal call as it was', () => {
    expect(
      buildProspectMessages([
        { speaker: 'prospect', text: 'Claire Hughes.' },
        { speaker: 'rep', text: "Hi Claire, it's Sam." },
      ]),
    ).toEqual([
      { role: 'user', content: '(Your phone rings and you answer.)' },
      { role: 'assistant', content: 'Claire Hughes.' },
      { role: 'user', content: "Hi Claire, it's Sam." },
    ]);
  });
});

describe("the notes on Sam's lines", () => {
  const turns = [
    { speaker: 'prospect' as const, text: 'Claire Hughes.' },
    { speaker: 'rep' as const, text: "Hi Claire, it's Sam from WattGuard. Thirty seconds?" },
    { speaker: 'prospect' as const, text: 'Go on, quickly.' },
    { speaker: 'rep' as const, text: 'How do you see energy site by site today?' },
  ];

  it('numbers the call and names the turns to annotate', () => {
    const user = buildRepNotesUserPrompt({
      scenario,
      turns,
      outcome: 'meeting_booked',
      outcomeReason: 'Tuesday at 10am',
    });
    expect(user).toContain('Claire Hughes, Finance Director at Harrow & Finch Logistics');
    expect(user).toContain('How the call ended: Sam booked the meeting: Tuesday at 10am.');
    expect(user).toContain('1. Claire: Claire Hughes.\n2. Sam: Hi Claire');
    expect(user).toContain("Write the notes for Sam's lines: turns 2, 4.");
    const system = buildRepNotesSystemPrompt({ product });
    expect(system).toContain(expertPlaybook('WattGuard'));
    expect(system).toContain('where a line was a misstep, name it as one');
  });

  const draft = (patch: Partial<RepNotesDraft> = {}): RepNotesDraft => ({
    notes: [
      { turn: 4, technique: ' Open discovery ', note: ' Gets her talking about her sites. ' },
      { turn: 2, technique: 'Permission opener', note: 'She gets to say yes first.' },
      { turn: 2, technique: 'Duplicate', note: 'The first note for a line wins.' },
      { turn: 3, technique: 'Her line', note: 'Not one of his.' },
      { turn: 9, technique: 'Out of range', note: 'No such turn.' },
      { turn: 4, technique: ' ', note: 'Blank technique.' },
    ],
    summary: ' A short, clean call. ',
    lessons: [' Ask first. ', '', 'Follow up.', 'L3', 'L4', 'L5', 'L6'],
    ...patch,
  });

  it("keeps one note for each of Sam's lines, in order, and trims everything", () => {
    expect(repNotesFrom(draft(), turns)).toEqual({
      notes: [
        { turn: 2, technique: 'Permission opener', note: 'She gets to say yes first.' },
        { turn: 4, technique: 'Open discovery', note: 'Gets her talking about her sites.' },
      ],
      summary: 'A short, clean call.',
      lessons: ['Ask first.', 'Follow up.', 'L3', 'L4', 'L5'],
    });
  });

  it("refuses notes that miss every one of Sam's lines", () => {
    expect(() =>
      repNotesFrom(draft({ notes: [{ turn: 1, technique: 'X', note: 'Y' }] }), turns),
    ).toThrow(RepNotesError);
  });
});
