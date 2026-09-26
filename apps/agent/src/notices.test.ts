import { describe, expect, it, vi } from 'vitest';
import { CallNotices, CostWatch } from './notices.ts';

describe('CallNotices', () => {
  it('sends a notice once, and again only when its words change', () => {
    const send = vi.fn();
    const notices = new CallNotices(send);
    const tts = { level: 'error', code: 'tts', message: 'Her voice (Cartesia) failed.' } as const;
    expect(notices.notify(tts)).toBe(true);
    expect(notices.notify(tts)).toBe(false);
    expect(notices.notify({ ...tts, code: 'stt' })).toBe(true);
    expect(notices.notify({ ...tts, message: 'Her voice (Cartesia) failed again.' })).toBe(true);
    expect(send).toHaveBeenCalledTimes(3);
  });
});

describe('CostWatch', () => {
  it('warns once, the first time the cost passes the line', () => {
    let spent = 1.9;
    const onOver = vi.fn();
    const watch = new CostWatch({ warnAboveUsd: 2, costSoFar: () => spent, onOver });
    watch.check();
    spent = 2;
    watch.check(); // at the line is not over it
    expect(onOver).not.toHaveBeenCalled();
    spent = 2.04;
    watch.check();
    spent = 2.5;
    watch.check();
    expect(onOver).toHaveBeenCalledExactlyOnceWith(2.04, 2);
  });

  it('watches nothing without a price table', () => {
    const onOver = vi.fn();
    new CostWatch({ warnAboveUsd: null, costSoFar: () => 99, onOver }).check();
    expect(onOver).not.toHaveBeenCalled();
  });
});
