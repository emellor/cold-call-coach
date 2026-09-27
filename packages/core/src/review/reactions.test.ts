import { describe, expect, it } from 'vitest';
import { signalWords, stageWords, turnReactions } from './reactions.ts';

const judgement = (turn: number, patch: Record<string, unknown> = {}) => ({
  kind: 'judgement' as const,
  payload: {
    turn,
    judged: true,
    stage: 'discovery',
    signals: ['askedOpenQuestion'],
    revealEarned: null,
    tip: null,
    interest: [20, 25],
    patience: [55, 52],
    ...patch,
  },
});

const turns = [
  { speaker: 'prospect' as const },
  { speaker: 'rep' as const },
  { speaker: 'prospect' as const },
  { speaker: 'rep' as const },
  { speaker: 'prospect' as const },
  { speaker: 'rep' as const },
];

describe('turnReactions', () => {
  it('pins each judgement to its rep turn in the transcript', () => {
    const reactions = turnReactions(turns, [
      { kind: 'pause', payload: {} },
      judgement(1, { stage: 'opener', signals: ['askedPermission'], interest: [20, 24] }),
      judgement(2, { revealEarned: 'pain_1' }),
      judgement(3, { judged: false, stage: 'other', signals: [], patience: [52, 49] }),
    ]);
    expect(reactions).toEqual([
      undefined,
      {
        interest: [20, 24],
        patience: [55, 52],
        reading: { stage: 'opener', signals: ['askedPermission'], revealed: null },
      },
      undefined,
      {
        interest: [20, 25],
        patience: [55, 52],
        reading: { stage: 'discovery', signals: ['askedOpenQuestion'], revealed: 'pain_1' },
      },
      undefined,
      { interest: [20, 25], patience: [52, 49], reading: null },
    ]);
  });

  it('takes the retake’s judgement after a rewind, and skips what it cannot read', () => {
    const reactions = turnReactions(turns, [
      judgement(1),
      judgement(2, { signals: ['pitchedFeatures'], interest: [25, 20] }), // taken back
      judgement(2, { signals: ['followedUp'], interest: [25, 31] }), // the retake
      { kind: 'judgement', payload: { turn: 3, judged: 'yes' } },
    ]);
    expect(reactions[3]).toMatchObject({
      interest: [25, 31],
      reading: { signals: ['followedUp'] },
    });
    expect(reactions[5]).toBeUndefined();
  });

  it('gives nothing for a call logged without judgements', () => {
    expect(turnReactions(turns, [])).toEqual(turns.map(() => undefined));
  });
});

describe('signalWords and stageWords', () => {
  it('says what the judge saw in words, keeping a name it does not know', () => {
    expect(signalWords('ignoredHerPoint')).toBe('ignored her point');
    expect(signalWords('somethingNew')).toBe('somethingNew');
    expect(stageWords('objection_handling')).toBe('objection handling');
  });
});
