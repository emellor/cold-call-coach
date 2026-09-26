import { Topics } from '@ccc/contracts';
import { initializeLogger, log } from '@livekit/agents';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CallController, RING_MS, ringDelayMs } from './call.ts';

initializeLogger({ pretty: false, level: 'silent' });

function setup(random = () => 0.5) {
  const events: string[] = [];
  const deps = {
    session: {
      input: { setAudioEnabled: vi.fn((on: boolean) => events.push(`audio:${on ? 'on' : 'off'}`)) },
      say: vi.fn((text: string) => events.push(`say:${text}`)),
    },
    publisher: {
      publish: vi.fn((topic: { name: string }, payload: unknown) => {
        events.push(`${topic.name}:${JSON.stringify(payload)}`);
        return Promise.resolve();
      }),
    },
    shutdown: vi.fn((reason: string) => events.push(`shutdown:${reason}`)),
    logger: log(),
    openingLine: 'Claire Hughes.',
    random,
  };
  return { controller: new CallController(deps), deps, events };
}

describe('ringDelayMs', () => {
  it('spans 2–5 seconds', () => {
    expect(ringDelayMs(() => 0)).toBe(RING_MS.min);
    expect(ringDelayMs(() => 0.999999)).toBe(RING_MS.max);
  });
});

describe('CallController', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('rings with the rep muted, then picks up with the opening line and no LLM', async () => {
    const { controller, events } = setup(() => 0);
    const pickUp = controller.ringAndPickUp();
    await vi.advanceTimersByTimeAsync(RING_MS.min - 1);
    expect(events).toEqual(['audio:off', `${Topics.callState.name}:{"phase":"ringing"}`]);
    expect(controller.phase).toBe('ringing');

    await vi.advanceTimersByTimeAsync(1);
    await pickUp;
    expect(events.slice(2)).toEqual([
      'audio:on',
      `${Topics.callState.name}:{"phase":"connected"}`,
      'say:Claire Hughes.',
    ]);
    expect(controller.phase).toBe('connected');
  });

  it('never picks up if the rep hangs up while it is ringing', async () => {
    const { controller, deps, events } = setup();
    const pickUp = controller.ringAndPickUp();
    await vi.advanceTimersByTimeAsync(500);
    await controller.end('ended_by_rep');
    await vi.advanceTimersByTimeAsync(RING_MS.max);
    await pickUp;
    expect(deps.session.say).not.toHaveBeenCalled();
    expect(events.at(-2)).toBe(
      `${Topics.callState.name}:{"phase":"ended","outcome":"ended_by_rep"}`,
    );
    expect(events.at(-1)).toBe('shutdown:ended_by_rep');
  });

  it('ends the call at the 15-minute limit', async () => {
    const { controller, deps } = setup(() => 0);
    const pickUp = controller.ringAndPickUp();
    await vi.advanceTimersByTimeAsync(RING_MS.min);
    await pickUp;
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000 - 1);
    expect(deps.shutdown).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(deps.shutdown).toHaveBeenCalledWith('timeout');
    expect(deps.publisher.publish).toHaveBeenLastCalledWith(Topics.callState, {
      phase: 'ended',
      outcome: 'timeout',
      reason: 'The 15-minute call limit was reached.',
    });
  });

  it('ends only once, keeping the first outcome', async () => {
    const { controller, deps } = setup();
    await Promise.all([controller.end('hung_up_by_prospect'), controller.end('ended_by_rep')]);
    await controller.end('error');
    expect(deps.shutdown).toHaveBeenCalledTimes(1);
    expect(deps.shutdown).toHaveBeenCalledWith('hung_up_by_prospect');
  });
});

describe('CallController and a booked meeting', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function connected() {
    const ctx = setup(() => 0);
    const pickUp = ctx.controller.ringAndPickUp();
    await vi.advanceTimersByTimeAsync(RING_MS.min);
    await pickUp;
    ctx.events.length = 0;
    return ctx;
  }

  it('announces the meeting and keeps the call going', async () => {
    const { controller, events, deps } = await connected();
    await controller.recordMeeting('Tuesday at 10am');
    expect(events).toEqual([
      `${Topics.callState.name}:{"phase":"connected","outcome":"meeting_booked","reason":"Tuesday at 10am"}`,
    ]);
    expect(controller.phase).toBe('connected');
    expect(deps.shutdown).not.toHaveBeenCalled();
  });

  it('ends as meeting_booked however the call then ends, keeping the first slot', async () => {
    const { controller, events } = await connected();
    await controller.recordMeeting('Tuesday at 10am');
    await controller.recordMeeting('Wednesday at 3pm');
    await controller.end('ended_by_rep');
    expect(events.slice(1)).toEqual([
      `${Topics.callState.name}:{"phase":"ended","outcome":"meeting_booked","reason":"Tuesday at 10am"}`,
      'shutdown:meeting_booked',
    ]);
  });

  it('ignores a meeting before she has picked up or after the call ended', async () => {
    const ringing = setup();
    await ringing.controller.recordMeeting('Monday');
    expect(ringing.events).toEqual([]);

    const { controller, events } = await connected();
    await controller.end('hung_up_by_prospect', 'Not interested');
    await controller.recordMeeting('Monday');
    expect(events).toEqual([
      `${Topics.callState.name}:{"phase":"ended","outcome":"hung_up_by_prospect","reason":"Not interested"}`,
      'shutdown:hung_up_by_prospect',
    ]);
  });
});
