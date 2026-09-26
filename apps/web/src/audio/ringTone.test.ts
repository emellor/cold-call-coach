import { describe, expect, it } from 'vitest';
import { RING_PERIOD_S, ringBursts } from './ringTone.ts';

describe('ringBursts', () => {
  it('follows the UK cadence: 0.4 on, 0.2 off, 0.4 on, 2.0 off', () => {
    expect(ringBursts(2)).toEqual([
      { on: 0, off: 0.4 },
      { on: 0.6, off: 1.0 },
      { on: 3.0, off: 3.4 },
      { on: 3.6, off: 4.0 },
    ]);
  });

  it('repeats every three seconds', () => {
    const bursts = ringBursts(5);
    expect(bursts).toHaveLength(10);
    expect(bursts[8]?.on).toBeCloseTo(4 * RING_PERIOD_S);
  });
});
