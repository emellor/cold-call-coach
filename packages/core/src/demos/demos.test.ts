import { DEMO_GAP_MS, type DemoNotesDraft } from '@ccc/contracts';
import { describe, expect, it } from 'vitest';
import { product, scenario } from '../test/fixtures.ts';
import { buildDemoNotesSystemPrompt, buildDemoNotesUserPrompt, notesFrom } from './notes.ts';
import { DEMO_ANGLES, demoDurationMs, demoPlan } from './plan.ts';

describe('demoPlan', () => {
  it('takes the prospects in turn, each demo with the next approach', () => {
    const plan = demoPlan(20, ['easy', 'medium', 'hard']);
    expect(plan).toHaveLength(20);
    expect(plan.slice(0, 4).map((p) => p.scenarioId)).toEqual(['easy', 'medium', 'hard', 'easy']);
    expect(plan[0]?.angle).toBe(DEMO_ANGLES[0]);
    expect(plan[11]?.angle).toBe(DEMO_ANGLES[1]);
    // Every prospect hears a different approach each time.
    for (const id of ['easy', 'medium', 'hard']) {
      const angles = plan.filter((p) => p.scenarioId === id).map((p) => p.angle);
      expect(new Set(angles).size).toBe(angles.length);
    }
  });

  it('plans nothing without a prospect', () => {
    expect(demoPlan(20, [])).toEqual([]);
  });
});

describe('demoDurationMs', () => {
  it('adds a gap between voiced lines, and knows nothing without audio', () => {
    expect(demoDurationMs([2_000, null, 3_000])).toBe(5_000 + DEMO_GAP_MS);
    expect(demoDurationMs([null])).toBeNull();
  });
});

describe('the demo notes prompt', () => {
  it('asks for a technique and a reason for every rep line', () => {
    const system = buildDemoNotesSystemPrompt(product);
    expect(system).toContain(`sell WattGuard: ${product.oneLiner}`);
    expect(system).toContain('For every rep line, name the technique it uses');
  });

  it('numbers the rep lines and shows how she took each one', () => {
    const user = buildDemoNotesUserPrompt({
      scenario,
      angle: DEMO_ANGLES[3]!,
      outcome: 'meeting_booked',
      outcomeDetail: 'Tuesday at 10am',
      lines: [
        { speaker: 'prospect', text: 'Claire Hughes.' },
        { speaker: 'rep', text: 'Hi Claire, Sam here.', interest: [20, 24.6], patience: [55, 52] },
        { speaker: 'prospect', text: 'Go on.' },
        { speaker: 'rep', text: 'What does month end look like?' },
      ],
    });
    expect(user).toContain('- Pain: energy bills up about 40% in two years');
    expect(user).toContain(`The approach the rep was asked to take: ${DEMO_ANGLES[3]}`);
    expect(user).toContain('How the call ended: she agreed to a meeting (Tuesday at 10am).');
    expect(user).toContain(
      'Her: Claire Hughes.\nRep line 1: Hi Claire, Sam here.\n    (her interest 20 → 25, patience 55 → 52)\nHer: Go on.\nRep line 2: What does month end look like?\n',
    );
  });
});

describe('notesFrom', () => {
  const draft: DemoNotesDraft = {
    title: ' Earning thirty seconds ',
    summary: 'A permission opener, then discovery.',
    lessons: [' Ask first. ', '', 'Follow up.', 'Quantify.', 'Close.', 'Confirm.', 'Sixth'],
    lines: [
      { line: 2, technique: 'Open question', note: 'Gets her talking.' },
      { line: 1, technique: ' Permission opener ', note: ' Lowers her guard. ' },
      { line: 1, technique: 'Duplicate', note: 'ignored' },
      { line: 9, technique: 'Out of range', note: 'ignored' },
    ],
  };

  it('gives one entry per rep line, trimmed, and at most five lessons', () => {
    expect(notesFrom(draft, 3)).toEqual({
      title: 'Earning thirty seconds',
      summary: 'A permission opener, then discovery.',
      lessons: ['Ask first.', 'Follow up.', 'Quantify.', 'Close.', 'Confirm.'],
      lines: [
        { technique: 'Permission opener', note: 'Lowers her guard.' },
        { technique: 'Open question', note: 'Gets her talking.' },
        { technique: null, note: null },
      ],
    });
  });
});
