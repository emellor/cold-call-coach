import { describe, expect, it } from 'vitest';
import { TIP_MAX_HOLD_MS, TIP_MIN_GAP_MS, TipGate } from './tipGate.ts';

const warn = (text = 'Ask her an open question.') => ({ severity: 'warn' as const, text });
const info = { severity: 'info' as const, text: 'Nice permission ask.' };

describe('TipGate', () => {
  it('passes a warn tip in a coached call, numbering each one', () => {
    const gate = new TipGate('coached');
    expect(gate.offer(warn(), 3, 1_000, false)).toEqual({
      id: 'tip-1',
      turn: 3,
      severity: 'warn',
      text: 'Ask her an open question.',
    });
    expect(gate.offer(warn('Slow down.'), 9, 1_000 + TIP_MIN_GAP_MS, false)?.id).toBe('tip-2');
  });

  it('shows nothing in an exam call, and no info tips or empty judgements', () => {
    expect(new TipGate('exam').offer(warn(), 1, 0, false)).toBeNull();
    const gate = new TipGate('coached');
    expect(gate.offer(info, 1, 0, false)).toBeNull();
    expect(gate.offer(null, 2, 0, false)).toBeNull();
  });

  it('allows at most one tip every 20 s', () => {
    const gate = new TipGate('coached');
    expect(gate.offer(warn(), 1, 0, false)).not.toBeNull();
    expect(gate.offer(warn(), 2, TIP_MIN_GAP_MS - 1, false)).toBeNull();
    expect(gate.offer(warn(), 3, TIP_MIN_GAP_MS, false)).not.toBeNull();
  });

  it('holds a tip while she talks over the rep and releases it when that stops', () => {
    const gate = new TipGate('coached');
    expect(gate.offer(warn(), 4, 10_000, true)).toBeNull();
    expect(gate.release(12_000)).toMatchObject({ turn: 4, id: 'tip-1' });
    expect(gate.release(12_100)).toBeNull(); // released once
  });

  it('drops a held tip that has gone stale, or that a rewind took back', () => {
    const stale = new TipGate('coached');
    stale.offer(warn(), 4, 10_000, true);
    expect(stale.release(10_000 + TIP_MAX_HOLD_MS + 1)).toBeNull();

    const rewound = new TipGate('coached');
    rewound.offer(warn(), 4, 10_000, true);
    rewound.discardFrom(4);
    expect(rewound.release(10_500)).toBeNull();

    const earlier = new TipGate('coached');
    earlier.offer(warn(), 3, 10_000, true);
    earlier.discardFrom(4);
    expect(earlier.release(10_500)).not.toBeNull();
  });

  it('keeps only the newest held tip', () => {
    const gate = new TipGate('coached');
    gate.offer(warn('First.'), 4, 10_000, true);
    gate.offer(warn('Second.'), 5, 11_000, true);
    expect(gate.release(11_500)).toMatchObject({ turn: 5, text: 'Second.' });
  });
});
