import type { CallMode, CallStage } from '@ccc/contracts';
import { TIP_MIN_GAP_MS } from '@ccc/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveCoach, METRICS_INTERVAL_MS } from './liveCoach.ts';

const warn = (text: string) => ({ tip: { severity: 'warn' as const, text } });

function setup(mode: CallMode = 'coached', repStopLagMs = 0) {
  let now = 1_000_000;
  const stages: CallStage[] = [];
  const sent: Array<{ topic: string; payload: unknown }> = [];
  const coach = new LiveCoach({
    mode,
    publisher: {
      publish: (topic, payload) => {
        sent.push({ topic: topic.name, payload });
        return Promise.resolve();
      },
    },
    stages: () => stages,
    repStopLagMs,
    now: () => now,
  });
  const on = (topic: string) => sent.filter((m) => m.topic === topic).map((m) => m.payload);
  return {
    coach,
    stages,
    sent,
    on,
    at: (ms: number) => {
      now = 1_000_000 + ms;
      return now;
    },
  };
}

describe('LiveCoach', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('opens the tracker on the opener and publishes metrics twice a second once she picks up', () => {
    const { coach, on, at } = setup();
    coach.connected();
    expect(on('coach.stage')).toEqual([{ stage: 'opener', status: 'active' }]);

    coach.agentState('speaking', at(0));
    coach.agentState('listening', at(1_000));
    coach.userState('speaking', at(2_000));
    at(3_000);
    vi.advanceTimersByTime(METRICS_INTERVAL_MS * 2);
    expect(on('coach.metrics')).toHaveLength(2);
    expect(on('coach.metrics').at(-1)).toMatchObject({
      elapsedSec: 3,
      talkRatio: 0.5,
      currentMonologueSec: 1,
    });
  });

  it('publishes nothing at all in an exam call', () => {
    const { coach, sent, at } = setup('exam');
    coach.connected();
    coach.userState('speaking', at(0));
    coach.judged(1, warn('Ask an open question.'));
    coach.meetingBooked();
    vi.advanceTimersByTime(5_000);
    expect(sent).toEqual([]);
  });

  it('takes the VAD’s silence window off the rep’s talking time', () => {
    const { coach, on, at } = setup('coached', 500);
    coach.connected();
    coach.userState('speaking', at(0));
    coach.userState('listening', at(4_500)); // they stopped at 4 s
    coach.agentState('speaking', at(5_000));
    coach.agentState('listening', at(9_000));
    coach.publishMetrics();
    expect(on('coach.metrics').at(-1)).toMatchObject({ talkRatio: 0.5, longestMonologueSec: 4 });
  });

  it('fills pace, fillers and questions from the committed turns', () => {
    const { coach, on } = setup();
    coach.connected();
    coach.turnsChanged([
      { speaker: 'prospect', text: 'Claire Hughes.', startMs: 0, endMs: 800 },
      {
        speaker: 'rep',
        text: 'Um, hi Claire. What does energy cost you? Is it rising?',
        startMs: 1_000,
        endMs: 5_000,
      },
    ]);
    coach.publishMetrics();
    expect(on('coach.metrics').at(-1)).toMatchObject({
      repWpm: 165, // 11 words in 4 s
      coreFillers: 1,
      questionsOpen: 1,
      questionsClosed: 1,
    });
  });

  it('moves the tracker with each judged stage and completes it when a meeting is booked', () => {
    const { coach, stages, on } = setup();
    coach.connected();
    stages.push('opener', 'reason');
    coach.judged(2, { tip: null });
    expect(on('coach.stage').slice(1)).toEqual([
      { stage: 'opener', status: 'done' },
      { stage: 'reason', status: 'active' },
    ]);
    stages.push('close');
    coach.judged(3, { tip: null });
    coach.meetingBooked();
    expect(on('coach.stage').slice(3)).toEqual([
      { stage: 'reason', status: 'done' },
      { stage: 'next_step', status: 'active' },
      { stage: 'next_step', status: 'done' },
    ]);
  });

  it('passes warn tips at most every 20 s, and holds one while she talks over the rep', () => {
    const { coach, on, at } = setup();
    coach.connected();
    at(1_000);
    coach.judged(1, warn('Ask an open question.'));
    expect(on('coach.tip')).toEqual([
      { id: 'tip-1', turn: 1, severity: 'warn', text: 'Ask an open question.' },
    ]);
    at(10_000);
    coach.judged(2, warn('Too soon.'));
    expect(on('coach.tip')).toHaveLength(1);

    coach.userState('speaking', at(1_000 + TIP_MIN_GAP_MS));
    coach.agentState('speaking', at(1_000 + TIP_MIN_GAP_MS + 100));
    coach.judged(3, warn('Let her finish.'));
    expect(on('coach.tip')).toHaveLength(1); // both talking: held
    coach.userState('listening', at(1_000 + TIP_MIN_GAP_MS + 1_500));
    expect(on('coach.tip').at(-1)).toMatchObject({ turn: 3, text: 'Let her finish.' });
  });

  it('steps the tracker back and drops a held tip when the rep rewinds', () => {
    const { coach, stages, on, at } = setup();
    coach.connected();
    stages.push('opener', 'discovery');
    coach.judged(2, { tip: null });
    coach.userState('speaking', at(0));
    coach.agentState('speaking', at(100));
    coach.judged(3, warn('About turn 3.'));
    stages.splice(1);
    coach.rewound(2);
    expect(on('coach.stage').slice(-2)).toEqual([
      { stage: 'discovery', status: 'pending' },
      { stage: 'opener', status: 'active' },
    ]);
    coach.userState('listening', at(500));
    expect(on('coach.tip')).toEqual([]);
  });

  it('stops the talk clock while paused and publishes nothing once the call has ended', () => {
    const { coach, on, sent, at } = setup();
    coach.connected();
    coach.userState('speaking', at(0));
    coach.paused(at(2_000));
    coach.userState('speaking', at(3_000)); // the VAD, still hearing the muted mic: ignored
    at(10_000);
    coach.publishMetrics();
    expect(on('coach.metrics').at(-1)).toMatchObject({ talkRatio: 1, currentMonologueSec: 0 });
    coach.resumed();
    coach.ended();
    const count = sent.length;
    vi.advanceTimersByTime(2_000);
    coach.judged(4, warn('Late.'));
    expect(sent).toHaveLength(count);
  });
});
