import { describe, expect, it } from 'vitest';
import { NO_CONTROLS, anyControlsUsed, controlsUsed } from './controls.ts';

describe('controlsUsed', () => {
  it('tallies pauses, paused time, help and rewinds from the events', () => {
    const used = controlsUsed([
      { kind: 'judgement', payload: { turn: 1 } },
      { kind: 'pause', payload: {} },
      { kind: 'resume', payload: { pausedMs: 12_000 } },
      { kind: 'hint', payload: { say: 'What drives that?', why: 'Discovery.', ms: 1_800 } },
      // Logged before Get help, when the button gave three lines: still a use of it.
      { kind: 'hint', payload: { suggestions: ['a', 'b', 'c'], ms: 1_600 } },
      { kind: 'pause', payload: {} },
      { kind: 'resume', payload: { pausedMs: 3_500 } },
      {
        kind: 'rewind',
        payload: { beforeTurn: 5, tookBack: 'Can I send you a brochure?', herReply: 'Go on.' },
      },
    ]);
    expect(used).toEqual({
      pauses: 2,
      pausedMs: 15_500,
      hints: 2,
      rewinds: [{ beforeTurn: 5, tookBack: 'Can I send you a brochure?' }],
    });
    expect(anyControlsUsed(used)).toBe(true);
  });

  it('skips a payload it cannot read, and reports none used for a plain call', () => {
    expect(
      controlsUsed([
        { kind: 'resume', payload: { pausedMs: 'long' } },
        { kind: 'rewind', payload: { tookBack: 'x' } },
      ]),
    ).toEqual(NO_CONTROLS);
    expect(anyControlsUsed(controlsUsed([{ kind: 'outcome', payload: {} }]))).toBe(false);
  });
});
