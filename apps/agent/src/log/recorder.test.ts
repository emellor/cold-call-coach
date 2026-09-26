import { CallLog } from '@ccc/contracts';
import { describe, expect, it } from 'vitest';
import { readPriceTable } from '../prices.ts';
import { CallRecorder } from './recorder.ts';

const T0 = Date.parse('2026-09-26T10:00:00.000Z');
const priced = await readPriceTable();
if (!priced.ok) throw new Error(priced.problem);
const { prices } = priced;

function recorderAt() {
  let now = T0 - 3_000; // ringing
  const recorder = new CallRecorder(() => now, prices);
  return {
    recorder,
    at: (msAfterPickUp: number) => {
      now = T0 + msAfterPickUp;
    },
  };
}

const sec = (msAfterPickUp: number) => (T0 + msAfterPickUp) / 1000;
const state = { turn: 1, interest: 30, patience: 50, painsRevealed: [] };

describe('CallRecorder', () => {
  it('times every turn from the moment she picked up, from LiveKit’s speaking metrics', () => {
    const { recorder, at } = recorderAt();
    at(0);
    recorder.connected();
    at(1_000);
    recorder.prospectTurn({
      text: 'Claire Hughes.',
      timing: { startedSpeakingAt: sec(100), stoppedSpeakingAt: sec(900), committedAt: T0 + 1_000 },
      interrupted: false,
      state: null,
    });
    at(6_500);
    recorder.repTurn({
      text: 'Hi Claire, Sam from WattGuard.',
      timing: {
        startedSpeakingAt: sec(1_500),
        stoppedSpeakingAt: sec(6_000),
        committedAt: T0 + 6_500,
      },
      repTurn: 1,
    });
    at(20_000);
    const log = recorder.build({
      outcome: 'ended_by_rep',
      stateAfterRepTurn: (n) => (n === 1 ? state : null),
    });
    expect(log.turns.map((t) => [t.idx, t.speaker, t.startMs, t.endMs])).toEqual([
      [0, 'prospect', 100, 900],
      [1, 'rep', 1_500, 6_000],
    ]);
    expect(log.turns[1]?.stateAfter).toEqual(state);
    expect(log.connectedAt).toBe('2026-09-26T10:00:00.000Z');
    expect(log.durationMs).toBe(20_000);
    expect(CallLog.safeParse(log).success).toBe(true);
  });

  it('pins Deepgram’s word times to the start of the rep’s turn, keeping their gaps', () => {
    const { recorder, at } = recorderAt();
    at(0);
    recorder.connected();
    // Deepgram's clock: this stream started long before the call.
    recorder.sttFinal([
      { text: 'Hi', startTime: 101.0, endTime: 101.2 },
      { text: 'Claire.', startTime: 101.3, endTime: 101.8 },
    ]);
    recorder.sttFinal([{ text: 'Got', startTime: 103.9, endTime: 104.1 }]);
    at(9_000);
    recorder.repTurn({
      text: 'Hi Claire. Got',
      timing: {
        startedSpeakingAt: sec(5_000),
        stoppedSpeakingAt: sec(8_200),
        committedAt: T0 + 9_000,
      },
      repTurn: 1,
    });
    recorder.repTurn({
      text: 'Next turn.',
      timing: { startedSpeakingAt: sec(12_000), stoppedSpeakingAt: sec(13_000), committedAt: T0 },
      repTurn: 2,
    });
    const log = recorder.build({ outcome: 'ended_by_rep', stateAfterRepTurn: () => null });
    expect(log.turns[0]?.words).toEqual([
      { text: 'Hi', startMs: 5_000, endMs: 5_200 },
      { text: 'Claire.', startMs: 5_300, endMs: 5_800 },
      { text: 'Got', startMs: 7_900, endMs: 8_100 },
    ]);
    // Words are handed to one turn only.
    expect(log.turns[1]?.words).toBeNull();
  });

  it('estimates a turn’s span from its text when the metrics are missing', () => {
    const { recorder, at } = recorderAt();
    at(0);
    recorder.connected();
    at(10_000);
    recorder.repTurn({
      text: 'one two three four five',
      timing: { committedAt: T0 + 10_000 },
      repTurn: 1,
    });
    const [turn] = recorder.build({ outcome: 'error', stateAfterRepTurn: () => null }).turns;
    expect(turn).toMatchObject({ startMs: 8_000, endMs: 10_000 });
  });

  it('sums usage per lane, priced by the model that answered', () => {
    const { recorder } = recorderAt();
    const usage = {
      inputTokens: 1_000,
      cacheReadInputTokens: 2_000,
      cacheCreationInputTokens: 0,
      outputTokens: 100,
    };
    recorder.usage('prospect', 'claude-opus-5', usage);
    recorder.usage('prospect', 'claude-opus-5', usage);
    recorder.usage('judge', 'claude-haiku-4-5', usage);
    const log = recorder.build({ outcome: 'ended_by_rep', stateAfterRepTurn: () => null });
    expect(log.usage.prospect).toEqual({
      model: 'claude-opus-5',
      calls: 2,
      cachedCalls: 2,
      inputTokens: 2_000,
      cacheReadInputTokens: 4_000,
      cacheCreationInputTokens: 0,
      outputTokens: 200,
      costUsd: 0.017, // 2,000 × $5 + 4,000 × $0.50 + 200 × $25, per million
    });
    expect(log.usage.judge?.costUsd).toBe(0.0017);
  });

  it('stamps events with the time since pick-up, and never goes negative', () => {
    const { recorder, at } = recorderAt();
    recorder.event('error', { reason: 'before pick-up' });
    at(0);
    recorder.connected();
    at(4_250);
    recorder.event('judgement', { turn: 1 });
    const log = recorder.build({
      outcome: 'hung_up_by_prospect',
      reason: 'Out of patience',
      stateAfterRepTurn: () => null,
    });
    expect(log.events.map((e) => [e.kind, e.tMs])).toEqual([
      ['error', 0],
      ['judgement', 4_250],
    ]);
    expect(log.reason).toBe('Out of patience');
  });

  it('logs a call she never answered with no connect time and no duration', () => {
    const { recorder } = recorderAt();
    const log = recorder.build({ outcome: 'ended_by_rep', stateAfterRepTurn: () => null });
    expect(log).toMatchObject({ connectedAt: null, durationMs: 0, turns: [] });
    expect(CallLog.safeParse(log).success).toBe(true);
  });

  it('prices the hint lane apart from the prospect and the judge', () => {
    const { recorder } = recorderAt();
    const usage = {
      inputTokens: 1_000,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 100,
    };
    recorder.usage('hint', 'claude-opus-5', usage);
    const log = recorder.build({ outcome: 'ended_by_rep', stateAfterRepTurn: () => null });
    expect(log.usage.hint).toMatchObject({ calls: 1, cachedCalls: 0, costUsd: 0.0075 });
    expect(log.usage).not.toHaveProperty('judge');
  });

  it('counts the calls that read from the prompt cache', () => {
    const { recorder } = recorderAt();
    const turn = (cacheReadInputTokens: number) => ({
      inputTokens: 50,
      cacheReadInputTokens,
      cacheCreationInputTokens: cacheReadInputTokens ? 0 : 1_800,
      outputTokens: 30,
    });
    recorder.usage('prospect', 'claude-opus-5', turn(0)); // turn 1 writes the cache
    recorder.usage('prospect', 'claude-opus-5', turn(1_800));
    recorder.usage('prospect', 'claude-opus-5', turn(1_900));
    const log = recorder.build({ outcome: 'ended_by_rep', stateAfterRepTurn: () => null });
    expect(log.usage.prospect).toMatchObject({ calls: 3, cachedCalls: 2 });
  });

  it('adds up Deepgram audio and Cartesia characters, priced from the table', () => {
    const { recorder } = recorderAt();
    recorder.stt('nova-3', 300_000);
    recorder.stt('nova-3', 240_000);
    recorder.tts('sonic-3', 1_200);
    recorder.tts('sonic-3', 950);
    const log = recorder.build({ outcome: 'ended_by_rep', stateAfterRepTurn: () => null });
    expect(log.usage.stt).toEqual({ model: 'nova-3', audioMs: 540_000, costUsd: 0.0693 }); // 9 min
    expect(log.usage.tts).toEqual({ model: 'sonic-3', characters: 2_150, costUsd: 0.1075 });
    expect(recorder.costSoFar()).toBe(0.1768);
    expect(CallLog.safeParse(log).success).toBe(true);
  });

  it('prices nothing without a price table, and still logs the usage', () => {
    const recorder = new CallRecorder(() => T0, null);
    recorder.usage('prospect', 'claude-opus-5', {
      inputTokens: 10,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 10,
    });
    recorder.stt('nova-3', 60_000);
    const log = recorder.build({ outcome: 'ended_by_rep', stateAfterRepTurn: () => null });
    expect(log.usage.prospect?.costUsd).toBeNull();
    expect(log.usage.stt).toEqual({ model: 'nova-3', audioMs: 60_000, costUsd: null });
    expect(recorder.costSoFar()).toBe(0);
  });

  describe('rewind', () => {
    function threeTurns() {
      const { recorder, at } = recorderAt();
      at(0);
      recorder.connected();
      const turn = (speaker: 'rep' | 'prospect', text: string, from: number, to: number) => {
        const timing = { startedSpeakingAt: sec(from), stoppedSpeakingAt: sec(to), committedAt: 0 };
        if (speaker === 'rep') recorder.repTurn({ text, timing, repTurn: 1 });
        else recorder.prospectTurn({ text, timing, interrupted: false, state: null });
      };
      turn('prospect', 'Claire Hughes.', 0, 800);
      turn('rep', 'Can I send you a brochure?', 1_000, 3_000);
      turn('prospect', 'Just email me.', 3_500, 4_500);
      return recorder;
    }

    it('drops the rep’s last turn and her reply, and says what was taken back', () => {
      const recorder = threeTurns();
      // Words heard before the rewind must not leak into the retake.
      recorder.sttFinal([{ text: 'stray', startTime: 0, endTime: 0.2 }]);
      expect(recorder.rewind()).toEqual({
        beforeTurn: 2,
        tookBack: 'Can I send you a brochure?',
        herReply: 'Just email me.',
      });
      expect(recorder.metricTurns().map((t) => t.text)).toEqual(['Claire Hughes.']);
      // The retake takes the freed index.
      recorder.repTurn({
        text: 'What does energy cost you today?',
        timing: { startedSpeakingAt: sec(6_000), stoppedSpeakingAt: sec(8_000), committedAt: 0 },
        repTurn: 1,
      });
      const log = recorder.build({ outcome: 'ended_by_rep', stateAfterRepTurn: () => null });
      expect(log.turns.map((t) => [t.idx, t.text])).toEqual([
        [0, 'Claire Hughes.'],
        [1, 'What does energy cost you today?'],
      ]);
      expect(log.turns[1]?.words).toBeNull();
      expect(CallLog.safeParse(log).success).toBe(true);
    });

    it('has nothing to take back before the rep has spoken', () => {
      const { recorder } = recorderAt();
      expect(recorder.rewind()).toBeNull();
    });
  });
});
