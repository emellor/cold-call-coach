import { describe, expect, it } from 'vitest';
import { formatClock, median } from './stats.ts';

describe('median', () => {
  it('takes the middle value of an odd-length set, ignoring nulls', () => {
    expect(median([1300, null, 900, 2100])).toBe(1300);
  });

  it('averages the middle pair of an even-length set', () => {
    expect(median([1000, 1200, 800, 2000])).toBe(1100);
  });

  it('is null when there is nothing to measure', () => {
    expect(median([])).toBeNull();
    expect(median([null, null])).toBeNull();
  });
});

describe('formatClock', () => {
  it('formats minutes and zero-padded seconds', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65.9)).toBe('1:05');
    expect(formatClock(900)).toBe('15:00');
  });
});
