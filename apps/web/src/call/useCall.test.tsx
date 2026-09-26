import { act, renderHook } from '@testing-library/react';
import { ConnectionError, RpcError } from 'livekit-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HANG_UP_GRACE_MS,
  LIVEKIT_REFUSED_TOKEN,
  NO_ANSWER_MS,
  describeOutcome,
  reviewPathAfter,
  useCall,
} from './useCall.ts';

const fakes = vi.hoisted(() => {
  type Handler = (reader: { readAll(): Promise<string> }, info: { identity: string }) => unknown;

  class FakeRoom {
    static instances: FakeRoom[] = [];
    handlers = new Map<string, Handler>();
    listeners = new Map<string, ((...args: unknown[]) => void)[]>();
    connect = vi.fn(() => Promise.resolve());
    startAudio = vi.fn(() => Promise.resolve());
    localParticipant = {
      setMicrophoneEnabled: vi.fn((_on: boolean) => Promise.resolve()),
      /** The agent's answers, by method; a method missing here never answers. */
      performRpc: vi.fn(
        ({ method }: { destinationIdentity: string; method: string }): Promise<string> =>
          FakeRoom.answers[method]?.() ?? new Promise<string>(() => {}),
      ),
    };
    remoteParticipants = new Map([['agent-1', { identity: 'agent-1', isAgent: true }]]);
    static answers: Record<string, () => Promise<string>> = {};
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

vi.mock('livekit-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('livekit-client')>()),
  Room: fakes.FakeRoom,
  RoomEvent: {
    Disconnected: 'disconnected',
    Reconnecting: 'reconnecting',
    Reconnected: 'reconnected',
  },
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
    fakes.FakeRoom.answers = {};
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

  it('says LiveKit refused the token, not that a call it never let through dropped', async () => {
    mockCreateCall();
    const { result } = renderHook(() => useCall());
    const dialling = result.current.dial(request);
    const room = lastRoom();
    room.connect.mockImplementationOnce(() => {
      // As livekit-client does: a refused join is reported as a disconnect, then rejected.
      room.emit('disconnected', 5);
      return Promise.reject(
        ConnectionError.notAllowed('could not establish signal connection', 401),
      );
    });
    await act(() => dialling);
    expect(result.current.view).toMatchObject({
      phase: 'ended',
      outcome: 'error',
      message: LIVEKIT_REFUSED_TOKEN,
    });
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

const answer = (body: unknown) => () => Promise.resolve(JSON.stringify(body));
const refuse = (message: string) => () =>
  Promise.reject(new RpcError(RpcError.ErrorCode.APPLICATION_ERROR, message));

/** A coached (or exam) call she has answered. */
async function connectedCall(mode: 'coached' | 'exam' = 'coached') {
  mockCreateCall();
  const hook = renderHook(() => useCall());
  await act(() => hook.result.current.dial({ ...request, mode }));
  await act(() => lastRoom().deliver('call.state', { phase: 'connected' }));
  return hook;
}

const rpcMethods = () => lastRoom().localParticipant.performRpc.mock.calls.map(([p]) => p.method);
const mic = () => lastRoom().localParticipant.setMicrophoneEnabled.mock.calls.map(([on]) => on);

describe('useCall: the live coach', () => {
  beforeEach(() => {
    fakes.FakeRoom.instances = [];
    fakes.FakeRoom.answers = {};
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('fills the panel from the coach topics and drops malformed messages', async () => {
    const { result } = await connectedCall();
    const metrics = {
      elapsedSec: 12.5,
      talkRatio: 0.62,
      repWpm: 158,
      coreFillers: 2,
      softFillers: 1,
      fillersPerMin: 1.4,
      questionsOpen: 1,
      questionsClosed: 2,
      currentMonologueSec: 8.2,
      longestMonologueSec: 14,
    };
    await act(() => lastRoom().deliver('coach.metrics', metrics));
    await act(() => lastRoom().deliver('coach.metrics', { elapsedSec: -1 }));
    await act(() => lastRoom().deliver('coach.stage', { stage: 'opener', status: 'done' }));
    await act(() => lastRoom().deliver('coach.stage', { stage: 'reason', status: 'active' }));
    await act(() => lastRoom().deliver('coach.stage', { stage: 'pitch', status: 'active' }));
    const tip = { id: 'tip-1', turn: 2, severity: 'warn', text: 'Ask an open question.' };
    await act(() => lastRoom().deliver('coach.tip', tip));
    expect(result.current.view.coach).toEqual({
      metrics,
      stages: {
        opener: 'done',
        reason: 'active',
        discovery: 'pending',
        objections: 'pending',
        next_step: 'pending',
      },
      tip,
    });
  });
});

describe('useCall: a dropped connection', () => {
  beforeEach(() => {
    fakes.FakeRoom.instances = [];
    fakes.FakeRoom.answers = {};
  });
  afterEach(() => vi.restoreAllMocks());

  it('keeps the call going while LiveKit reconnects, and ends it only if that fails', async () => {
    const { result } = await connectedCall();
    act(() => lastRoom().emit('reconnecting'));
    expect(result.current.view).toMatchObject({ phase: 'connected', reconnecting: true });
    act(() => lastRoom().emit('reconnected'));
    expect(result.current.view).toMatchObject({ phase: 'connected', reconnecting: false });

    act(() => lastRoom().emit('reconnecting'));
    act(() => lastRoom().emit('disconnected', 3)); // not the rep's own doing
    expect(result.current.view).toMatchObject({
      phase: 'ended',
      outcome: 'error',
      reconnecting: false,
      message: "The connection dropped and couldn't be restored.",
    });
  });
});

describe('useCall: the agent’s notices', () => {
  beforeEach(() => {
    fakes.FakeRoom.instances = [];
    fakes.FakeRoom.answers = {};
  });
  afterEach(() => vi.restoreAllMocks());

  it('keeps the latest notice of each kind, in exam calls too, until dismissed', async () => {
    const { result } = await connectedCall('exam');
    const tts = { level: 'error', code: 'tts', message: 'Her voice (Cartesia) failed.' };
    await act(() => lastRoom().deliver('call.notice', tts));
    await act(() =>
      lastRoom().deliver('call.notice', { level: 'warn', code: 'cost', message: 'Over $2.' }),
    );
    await act(() =>
      lastRoom().deliver('call.notice', { level: 'warn', code: 'cost', message: 'Over $2 now.' }),
    );
    await act(() => lastRoom().deliver('call.notice', { level: 'loud', code: 'cost' }));
    expect(result.current.view.agentNotices).toEqual([
      tts,
      { level: 'warn', code: 'cost', message: 'Over $2 now.' },
    ]);
    act(() => result.current.dismissAgentNotice('tts'));
    expect(result.current.view.agentNotices.map((n) => n.code)).toEqual(['cost']);
  });
});

describe('useCall: the controls', () => {
  beforeEach(() => {
    fakes.FakeRoom.instances = [];
    fakes.FakeRoom.answers = {};
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('pauses by muting the mic before telling the agent, and resumes the other way round', async () => {
    fakes.FakeRoom.answers = {
      'call.pause': answer({ ok: true }),
      'call.resume': answer({ ok: true }),
    };
    const { result } = await connectedCall();
    await act(() => result.current.togglePause());
    expect(result.current.view.paused).toBe(true);
    expect(mic()).toEqual([true, false]);
    expect(lastRoom().localParticipant.performRpc).toHaveBeenLastCalledWith(
      expect.objectContaining({
        destinationIdentity: 'agent-1',
        method: 'call.pause',
        payload: '',
      }),
    );

    await act(() => result.current.togglePause());
    expect(result.current.view.paused).toBe(false);
    expect(rpcMethods()).toEqual(['call.pause', 'call.resume']);
    expect(mic()).toEqual([true, false, true]);
    expect(result.current.view.busy).toBeUndefined();
  });

  it('unpauses and says why when the agent refuses', async () => {
    fakes.FakeRoom.answers = { 'call.pause': refuse('Pause is off in exam mode.') };
    const { result } = await connectedCall();
    await act(() => result.current.togglePause());
    expect(result.current.view).toMatchObject({
      paused: false,
      notice: { text: 'Pause is off in exam mode.', tone: 'error' },
    });
    expect(mic()).toEqual([true, false, true]);
  });

  it('shows a hint: loading, then three lines, or the reason it failed', async () => {
    let release = (_text: string) => {};
    fakes.FakeRoom.answers = {
      'call.hint': () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    };
    const { result } = await connectedCall();
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.hint();
    });
    expect(result.current.view.hint).toEqual({ status: 'loading' });
    await act(async () => {
      release(JSON.stringify({ suggestions: ['One?', 'Two?', 'Three?'] }));
      await pending;
    });
    expect(result.current.view.hint).toEqual({
      status: 'ready',
      suggestions: ['One?', 'Two?', 'Three?'],
    });
    act(() => result.current.dismissHint());
    expect(result.current.view.hint).toBeUndefined();

    fakes.FakeRoom.answers['call.hint'] = refuse('The hint took too long. Try again.');
    await act(() => result.current.hint());
    expect(result.current.view.hint).toEqual({
      status: 'error',
      message: 'The hint took too long. Try again.',
    });
  });

  it('rewinds, unmuting a paused call, and passes on a refusal as it is', async () => {
    fakes.FakeRoom.answers = {
      'call.pause': answer({ ok: true }),
      'call.rewind': answer({ ok: true }),
    };
    const { result } = await connectedCall();
    await act(() => result.current.togglePause());
    await act(() => result.current.rewind());
    expect(result.current.view).toMatchObject({
      paused: false,
      notice: { text: "Rewound. She'll say her line again: retake your turn.", tone: 'info' },
    });
    expect(mic().at(-1)).toBe(true);

    fakes.FakeRoom.answers['call.rewind'] = answer({
      ok: false,
      reason: "There's no turn of yours to take back yet.",
    });
    await act(() => result.current.rewind());
    expect(result.current.view.notice).toMatchObject({
      text: "There's no turn of yours to take back yet.",
    });
  });

  it('offers no controls in an exam call, and none before she picks up', async () => {
    const exam = await connectedCall('exam');
    await act(() => exam.result.current.togglePause());
    await act(() => exam.result.current.hint());
    await act(() => exam.result.current.rewind());
    expect(rpcMethods()).toEqual([]);

    mockCreateCall();
    const ringing = renderHook(() => useCall());
    await act(() => ringing.result.current.dial(request));
    await act(() => ringing.result.current.togglePause());
    expect(rpcMethods()).toEqual([]);
  });

  it('tells the agent it is hanging up, and leaves the room without waiting long', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { result } = await connectedCall();
    act(() => result.current.hangUp());
    expect(result.current.view).toMatchObject({ phase: 'ended', outcome: 'ended_by_rep' });
    expect(rpcMethods()).toEqual(['call.hangup']);
    expect(lastRoom().disconnect).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(HANG_UP_GRACE_MS));
    expect(lastRoom().disconnect).toHaveBeenCalled();
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

describe('reviewPathAfter', () => {
  const base = { latency: [], callId: 'c1' };
  it('goes to the review once a call she answered has ended', () => {
    expect(reviewPathAfter({ ...base, phase: 'ended', connectedAt: 1 })).toBe('/calls/c1');
  });
  it('stays put for a live call, or one she never answered', () => {
    expect(reviewPathAfter({ ...base, phase: 'connected', connectedAt: 1 })).toBeNull();
    expect(reviewPathAfter({ ...base, phase: 'ended' })).toBeNull();
    expect(reviewPathAfter({ phase: 'ended', connectedAt: 1 })).toBeNull();
  });
});
