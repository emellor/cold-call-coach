import { describe, expect, it } from 'vitest';
import { LatencyTracker } from './latency.ts';

describe('LatencyTracker', () => {
  it('reports the opening line as turn 0 with only a TTS figure', () => {
    const tracker = new LatencyTracker();
    expect(
      tracker.onItem({ type: 'message', role: 'assistant', metrics: { ttsNodeTtfb: 0.21 } }),
    ).toEqual({
      turn: 0,
      endOfTurnMs: null,
      llmTtftMs: null,
      ttsTtfbMs: 210,
      e2eMs: null,
    });
  });

  it('pairs the rep’s end-of-turn delay with the reply that follows, in milliseconds', () => {
    const tracker = new LatencyTracker();
    expect(
      tracker.onItem({ type: 'message', role: 'user', metrics: { endOfTurnDelay: 0.4104 } }),
    ).toBeNull();
    expect(
      tracker.onItem({
        type: 'message',
        role: 'assistant',
        metrics: { llmNodeTtft: 0.72, ttsNodeTtfb: 0.18, e2eLatency: 1.3 },
      }),
    ).toEqual({ turn: 1, endOfTurnMs: 410, llmTtftMs: 720, ttsTtfbMs: 180, e2eMs: 1300 });
  });

  it('does not reuse a rep turn’s end-of-turn delay for a second reply', () => {
    const tracker = new LatencyTracker();
    tracker.onItem({ type: 'message', role: 'user', metrics: { endOfTurnDelay: 0.5 } });
    tracker.onItem({ type: 'message', role: 'assistant', metrics: {} });
    expect(
      tracker.onItem({ type: 'message', role: 'assistant', metrics: {} })?.endOfTurnMs,
    ).toBeNull();
  });

  it('ignores non-message items', () => {
    expect(new LatencyTracker().onItem({ type: 'agent_handoff' })).toBeNull();
  });
});
