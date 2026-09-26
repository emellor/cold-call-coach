import { CoachMetricsPayload } from '@ccc/contracts';
import { describe, expect, it } from 'vitest';
import { NO_TURN_METRICS, liveCoachMetrics } from './liveMetrics.ts';
import { TalkClock } from './talkClock.ts';

describe('liveCoachMetrics', () => {
  it('takes talking time from the live clock and the rest from committed turns', () => {
    const clock = new TalkClock();
    clock.repStarted(0);
    clock.repStopped(6_000);
    clock.prospectStarted(7_000);
    clock.prospectStopped(9_000);
    clock.repStarted(10_000);
    const payload = liveCoachMetrics({
      elapsedMs: 12_345,
      talk: clock.snapshot(12_345),
      turns: {
        repWpm: 150,
        coreFillers: 2,
        softFillers: 1,
        fillersPerMin: 1.8,
        questionsOpen: 1,
        questionsClosed: 2,
      },
    });
    expect(payload).toEqual({
      elapsedSec: 12.3,
      talkRatio: 0.81, // 8.345 s of 10.345 s
      repWpm: 150,
      coreFillers: 2,
      softFillers: 1,
      fillersPerMin: 1.8,
      questionsOpen: 1,
      questionsClosed: 2,
      currentMonologueSec: 2.3,
      longestMonologueSec: 6,
    });
    expect(CoachMetricsPayload.parse(payload)).toEqual(payload);
  });

  it('has no talk ratio before anyone has spoken', () => {
    const payload = liveCoachMetrics({
      elapsedMs: 800,
      talk: new TalkClock().snapshot(800),
      turns: NO_TURN_METRICS,
    });
    expect(payload).toMatchObject({ talkRatio: null, repWpm: null, currentMonologueSec: 0 });
    expect(CoachMetricsPayload.safeParse(payload).success).toBe(true);
  });
});
