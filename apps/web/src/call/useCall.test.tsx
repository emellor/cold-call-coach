import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_ANSWER_MS, describeOutcome, useCall } from './useCall.ts';

const fakes = vi.hoisted(() => {
  type Handler = (reader: { readAll(): Promise<string> }, info: { identity: string }) => unknown;

  class FakeRoom {
    static instances: FakeRoom[] = [];
    handlers = new Map<string, Handler>();
    listeners = new Map<string, ((...args: unknown[]) => void)[]>();
    connect = vi.fn(() => Promise.resolve());
    startAudio = vi.fn(() => Promise.resolve());
    localParticipant = { setMicrophoneEnabled: vi.fn(() => Promise.resolve()) };
    disconnect = vi.fn(() => {
      this.emit('disconnected', 1);
      return Promise.resolve();
    });

    constructor() {
      FakeRoom.instances.push(this);
    }
    registerTextStreamHandler(topic: string, handler: Handler) {
      this.handlers.set(topic, handler);
    }
    on(event: string, fn: (...args: unknown[]) => void) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), fn]);
      return this;
    }
    emit(event: string, ...args: unknown[]) {
      for (const fn of this.listeners.get(event) ?? []) fn(...args);
    }
    async deliver(topic: string, payload: unknown) {
      await this.handlers.get(topic)?.(
        { readAll: () => Promise.resolve(JSON.stringify(payload)) },
        { identity: 'agent-1' },
      );
    }
  }

  const ring = { stop: vi.fn() };
  return { FakeRoom, ring };
});

vi.mock('livekit-client', () => ({
  Room: fakes.FakeRoom,
  RoomEvent: { Disconnected: 'disconnected' },
  DisconnectReason: { CLIENT_INITIATED: 1 },
}));
vi.mock('../audio/ringTone.ts', () => ({ RingTone: { start: () => fakes.ring } }));

const call = {
  callId: '7b0a4e2c-2b1f-4f55-9a0c-6d3f1c1e8a10',
  url: 'wss://test.livekit.cloud',
  token: 'jwt',
};

function mockCreateCall(status = 201, body: unknown = call) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

const lastRoom = () => fakes.FakeRoom.instances.at(-1)!;
const request = { scenarioId: 'medium-finance-director', mode: 'coached' } as const;

describe('useCall', () => {
  beforeEach(() => {
    fakes.FakeRoom.instances = [];
    fakes.ring.stop.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('creates the call, joins with the token, rings, and stops ringing when she answers', async () => {
    const fetchSpy = mockCreateCall();
    const { result } = renderHook(() => useCall());

    await act(() => result.current.dial(request));
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/calls',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(lastRoom().connect).toHaveBeenCalledWith(call.url, call.token);
    expect(lastRoom().localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(result.current.view).toMatchObject({ phase: 'ringing', callId: call.callId });
    expect(fakes.ring.stop).not.toHaveBeenCalled();

    await act(() => lastRoom().deliver('call.state', { phase: 'ringing' }));
    expect(fakes.ring.stop).not.toHaveBeenCalled();
    await act(() => lastRoom().deliver('call.state', { phase: 'connected' }));
    expect(fakes.ring.stop).toHaveBeenCalled();
    expect(result.current.view.phase).toBe('connected');
  });

  it('collects latency entries and ignores malformed ones', async () => {
    mockCreateCall();
    const { result } = renderHook(() => useCall());
    await act(() => result.current.dial(request));

    const entry = { turn: 1, endOfTurnMs: 400, llmTtftMs: 700, ttsTtfbMs: 180, e2eMs: 1300 };
    await act(() => lastRoom().deliver('debug.latency', entry));
    await act(() => lastRoom().deliver('debug.latency', { turn: 'two' }));
    expect(result.current.view.latency).toEqual([entry]);
  });

  it('shows why the agent ended the call and leaves the room', async () => {
    mockCreateCall();
    const { result } = renderHook(() => useCall());
    await act(() => result.current.dial(request));
    await act(() =>
      lastRoom().deliver('call.state', { phase: 'ended', outcome: 'hung_up_by_prospect' }),
    );
    expect(result.current.view).toMatchObject({
      phase: 'ended',
      outcome: 'hung_up_by_prospect',
      message: 'She hung up.',
    });
    expect(lastRoom().disconnect).toHaveBeenCalled();
  });

  it('follows her mood and announces a booked meeting without restarting the clock', async () => {
    mockCreateCall();
    const { result } = renderHook(() => useCall());
    await act(() => result.current.dial(request));
    await act(() => lastRoom().deliver('call.state', { phase: 'connected' }));
    const connectedAt = result.current.view.connectedAt;

    const state = { turn: 3, mood: 'happy', interest: 66, patience: 48 };
    await act(() => lastRoom().deliver('prospect.state', state));
    await act(() => lastRoom().deliver('prospect.state', { turn: 4, mood: 'furious' }));
    expect(result.current.view.prospect).toEqual(state);

    await act(() =>
      lastRoom().deliver('call.state', {
        phase: 'connected',
        outcome: 'meeting_booked',
        reason: 'Tuesday at 10am',
      }),
    );
    expect(result.current.view).toMatchObject({
      phase: 'connected',
      meeting: 'Tuesday at 10am',
      connectedAt,
    });

    await act(() =>
      lastRoom().deliver('call.state', {
        phase: 'ended',
        outcome: 'meeting_booked',
        reason: 'Tuesday at 10am',
      }),
    );
    expect(result.current.view).toMatchObject({
      phase: 'ended',
      outcome: 'meeting_booked',
      message: 'Meeting booked: Tuesday at 10am.',
    });
  });

  it('still ends as booked when the rep hangs up after the meeting', async () => {
    mockCreateCall();
    const { result } = renderHook(() => useCall());
    await act(() => result.current.dial(request));
    await act(() =>
      lastRoom().deliver('call.state', {
        phase: 'connected',
        outcome: 'meeting_booked',
        reason: 'Friday at 9am',
      }),
    );
    act(() => result.current.hangUp());
    expect(result.current.view).toMatchObject({
      phase: 'ended',
      outcome: 'meeting_booked',
      message: 'Meeting booked: Friday at 9am.',
    });
  });

  it('starts each call without the last one’s mood or meeting', async () => {
    mockCreateCall();
    const { result } = renderHook(() => useCall());
    await act(() => result.current.dial(request));
    await act(() =>
      lastRoom().deliver('prospect.state', { turn: 1, mood: 'angry', interest: 5, patience: 10 }),
    );
    act(() => result.current.hangUp());
    await act(() => result.current.dial(request));
    expect(result.current.view.prospect).toBeUndefined();
    expect(result.current.view.meeting).toBeUndefined();
  });

  it('hangs up on request', async () => {
    mockCreateCall();
    const { result } = renderHook(() => useCall());
    await act(() => result.current.dial(request));
    act(() => result.current.hangUp());
    expect(result.current.view).toMatchObject({ phase: 'ended', outcome: 'ended_by_rep' });
    expect(fakes.ring.stop).toHaveBeenCalled();
  });

  it('surfaces the API’s own message when the call cannot be created', async () => {
    mockCreateCall(503, { error: 'LiveKit is not configured on the server: set LIVEKIT_URL.' });
    const { result } = renderHook(() => useCall());
    await act(() => result.current.dial(request));
    expect(result.current.view).toMatchObject({
      phase: 'ended',
      outcome: 'error',
      message: 'LiveKit is not configured on the server: set LIVEKIT_URL.',
    });
    expect(fakes.ring.stop).toHaveBeenCalled();
  });

  it('explains a blocked microphone', async () => {
    mockCreateCall();
    const { result } = renderHook(() => useCall());
    const blocked = new DOMException('denied', 'NotAllowedError');
    const dialling = result.current.dial(request);
    lastRoom().localParticipant.setMicrophoneEnabled.mockRejectedValueOnce(blocked);
    await act(() => dialling);
    expect(result.current.view.message).toMatch(/Microphone access was blocked/);
  });

  it('gives up with a hint when nobody answers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mockCreateCall();
    const { result } = renderHook(() => useCall());
    await act(() => result.current.dial(request));
    await act(() => vi.advanceTimersByTimeAsync(NO_ANSWER_MS - 1));
    expect(result.current.view.phase).toBe('ringing');
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(result.current.view).toMatchObject({ phase: 'ended', outcome: 'error' });
    expect(result.current.view.message).toMatch(/No answer/);
  });
});

describe('describeOutcome', () => {
  it('puts the agent’s reason into words for the rep', () => {
    expect(describeOutcome('meeting_booked', 'Thursday at 2pm')).toBe(
      'Meeting booked: Thursday at 2pm.',
    );
    expect(describeOutcome('hung_up_by_prospect', 'Out of patience')).toBe(
      'She hung up. Her reason: “Out of patience”',
    );
    expect(describeOutcome('hung_up_by_prospect')).toBe('She hung up.');
    expect(describeOutcome('ended_by_rep', 'session closed')).toBe('You hung up.');
    expect(describeOutcome('timeout', 'The 15-minute call limit was reached.')).toBe(
      'The 15-minute call limit was reached.',
    );
    expect(describeOutcome('error')).toBe('The call failed.');
  });
});
