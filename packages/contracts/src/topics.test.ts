import { describe, expect, it } from 'vitest';
import { DispatchMetadata } from './call.ts';
import { Topics, parseTopicMessage } from './topics.ts';

describe('topic payloads', () => {
  it('parses a call.state message', () => {
    const text = JSON.stringify({ phase: 'ended', outcome: 'timeout', reason: '15-minute limit' });
    expect(parseTopicMessage(Topics.callState, text)).toEqual({
      phase: 'ended',
      outcome: 'timeout',
      reason: '15-minute limit',
    });
  });

  it('rejects an unknown phase and non-JSON text rather than throwing', () => {
    expect(parseTopicMessage(Topics.callState, JSON.stringify({ phase: 'on-hold' }))).toBeNull();
    expect(parseTopicMessage(Topics.callState, 'not json')).toBeNull();
  });

  it('allows missing latency stages as null but not negative times', () => {
    const ok = { turn: 0, endOfTurnMs: null, llmTtftMs: null, ttsTtfbMs: 180, e2eMs: null };
    expect(parseTopicMessage(Topics.debugLatency, JSON.stringify(ok))).toEqual(ok);
    const bad = { ...ok, ttsTtfbMs: -1 };
    expect(parseTopicMessage(Topics.debugLatency, JSON.stringify(bad))).toBeNull();
  });
});

describe('DispatchMetadata', () => {
  it('requires a uuid call id and a known mode', () => {
    const good = {
      callId: '7b0a4e2c-2b1f-4f55-9a0c-6d3f1c1e8a10',
      scenarioId: 'medium-finance-director',
      mode: 'coached',
    };
    expect(DispatchMetadata.parse(good)).toEqual(good);
    expect(DispatchMetadata.safeParse({ ...good, callId: 'x' }).success).toBe(false);
    expect(DispatchMetadata.safeParse({ ...good, mode: 'practice' }).success).toBe(false);
  });
});
