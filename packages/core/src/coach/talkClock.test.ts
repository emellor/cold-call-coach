import { describe, expect, it } from 'vitest';
import { TalkClock } from './talkClock.ts';

describe('TalkClock', () => {
  it('adds up each side’s speaking time, counting speech still under way', () => {
    const clock = new TalkClock();
    clock.repStarted(0);
    clock.repStopped(4_000);
    clock.prospectStarted(5_000);
    clock.prospectStopped(7_000);
    clock.repStarted(8_000);
    expect(clock.snapshot(9_500)).toMatchObject({
      repSpeechMs: 5_500,
      prospectSpeechMs: 2_000,
      repSpeaking: true,
      prospectSpeaking: false,
    });
  });

  it('runs the monologue timer while the rep speaks and holds it through a short pause', () => {
    const clock = new TalkClock();
    clock.repStarted(1_000);
    expect(clock.snapshot(11_000).currentMonologueMs).toBe(10_000);
    clock.repStopped(12_000);
    // A 1 s pause: the monologue may yet continue, so it holds at its length so far.
    expect(clock.snapshot(13_000).currentMonologueMs).toBe(11_000);
    clock.repStarted(13_000);
    expect(clock.snapshot(20_000).currentMonologueMs).toBe(19_000);
  });

  it('ends the monologue after 1.5 s of silence, keeping it as the longest', () => {
    const clock = new TalkClock();
    clock.repStarted(0);
    clock.repStopped(30_000);
    expect(clock.snapshot(31_600)).toMatchObject({
      currentMonologueMs: 0,
      longestMonologueMs: 30_000,
    });
    clock.repStarted(32_000);
    expect(clock.snapshot(35_000)).toMatchObject({
      currentMonologueMs: 3_000,
      longestMonologueMs: 30_000,
    });
  });

  it('ends the monologue when she speaks in the gap, however short', () => {
    const clock = new TalkClock();
    clock.repStarted(0);
    clock.repStopped(10_000);
    clock.prospectStarted(10_200);
    expect(clock.snapshot(10_400).currentMonologueMs).toBe(0);
    clock.prospectStopped(10_600);
    clock.repStarted(11_000);
    expect(clock.snapshot(12_000).currentMonologueMs).toBe(1_000);
  });

  it('keeps the monologue going when she only speaks over the rep, as the post-call metric does', () => {
    const clock = new TalkClock();
    clock.repStarted(0);
    clock.prospectStarted(2_000);
    expect(clock.overlapping).toBe(true);
    clock.prospectStopped(3_000);
    expect(clock.overlapping).toBe(false);
    expect(clock.snapshot(6_000).currentMonologueMs).toBe(6_000);
  });

  it('ignores repeated starts and stops, and never counts a stop before its start', () => {
    const clock = new TalkClock();
    clock.repStopped(100);
    clock.repStarted(1_000);
    clock.repStarted(2_000);
    clock.repStopped(900); // the VAD lag correction overshot
    expect(clock.snapshot(5_000)).toMatchObject({ repSpeechMs: 0, repSpeaking: false });
    expect(new TalkClock().snapshot(1_000)).toEqual({
      repSpeechMs: 0,
      prospectSpeechMs: 0,
      currentMonologueMs: 0,
      longestMonologueMs: 0,
      repSpeaking: false,
      prospectSpeaking: false,
    });
  });
});
