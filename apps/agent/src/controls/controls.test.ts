import type { CallMode, CallPhase, RewindEventPayload } from '@ccc/contracts';
import { llm } from '@livekit/agents';
import { describe, expect, it, vi } from 'vitest';
import { HintError } from '../coach/hint.ts';
import { silentLogger } from '../test/fixtures.ts';
import { CallControls, type CallControlsDeps, ControlError } from './controls.ts';

/** LiveKit's agent, as far as the controls use it: a chat context it can replace. */
class FakeAgent {
  chatCtx: llm.ChatContext;
  constructor(lines: Array<['user' | 'assistant', string]>) {
    this.chatCtx = new llm.ChatContext();
    this.chatCtx.addMessage({ role: 'system', content: 'You are Claire Hughes.' });
    for (const [role, content] of lines) this.chatCtx.addMessage({ role, content });
  }
  updateChatCtx(chatCtx: llm.ChatContext): Promise<void> {
    this.chatCtx = chatCtx;
    return Promise.resolve();
  }
  get lines() {
    return this.chatCtx.items.flatMap((item) =>
      item.type === 'message' && item.role !== 'system'
        ? [`${item.role}: ${item.textContent}`]
        : [],
    );
  }
}

const HELP = {
  say: 'What does month end look like for you?',
  why: 'Discovery: an open question about her process.',
  ifPushback: 'Fair enough. What would make ten minutes worth it?',
};

const TAKEN: RewindEventPayload = {
  beforeTurn: 2,
  tookBack: 'Can I send you a brochure?',
  herReply: 'Just email me.',
};

function setup(
  options: {
    mode?: CallMode;
    phase?: CallPhase;
    meeting?: string | null;
    lines?: Array<['user' | 'assistant', string]>;
    repTurns?: number;
  } = {},
) {
  let now = 50_000;
  const agent = new FakeAgent(
    options.lines ?? [
      ['assistant', 'Claire Hughes.'],
      ['user', 'Can I send you a brochure?'],
      ['assistant', 'Just email me.'],
    ],
  );
  const session = {
    input: { setAudioEnabled: vi.fn() },
    interrupt: vi.fn(() => ({ await: Promise.resolve() })),
    clearUserTurn: vi.fn(),
    say: vi.fn(),
  };
  const events: Array<[string, Record<string, unknown>]> = [];
  const brain = {
    repTurns: options.repTurns ?? 1,
    meeting: options.meeting ?? null,
    rewindTo: vi.fn(),
  };
  const coach = { paused: vi.fn(), resumed: vi.fn(), rewound: vi.fn(), turnsChanged: vi.fn() };
  const controller = { phase: options.phase ?? 'connected', end: vi.fn(() => Promise.resolve()) };
  const hints = vi.fn<CallControlsDeps['hints']>(() => Promise.resolve({ ...HELP, ms: 1_400 }));
  const latency = { rewound: vi.fn() };
  const rewindLog = vi.fn(() => TAKEN);
  const deps: CallControlsDeps = {
    mode: options.mode ?? 'coached',
    session,
    agent,
    brain,
    recorder: {
      event: (kind, payload) => events.push([kind, payload]),
      rewind: rewindLog,
      metricTurns: () => [],
    },
    coach,
    controller,
    hints,
    hintPrompt: () => ({ system: 'You coach.', user: 'Rep: hi' }),
    latency,
    logger: silentLogger,
    now: () => now,
  };
  return {
    controls: new CallControls(deps),
    agent,
    session,
    brain,
    coach,
    controller,
    hints,
    latency,
    events,
    rewindLog,
    wait: (ms: number) => {
      now += ms;
    },
  };
}

describe('CallControls: pause and resume', () => {
  it('mutes the rep to the agent, stops her, and logs both with the time paused', () => {
    const { controls, session, coach, events, wait } = setup();
    expect(controls.pause()).toEqual({ ok: true });
    expect(controls.paused).toBe(true);
    expect(session.input.setAudioEnabled).toHaveBeenLastCalledWith(false);
    expect(session.clearUserTurn).toHaveBeenCalledOnce();
    expect(session.interrupt).toHaveBeenCalledOnce();
    expect(coach.paused).toHaveBeenCalledWith(50_000);

    expect(controls.pause()).toEqual({ ok: true }); // already paused
    wait(12_000);
    expect(controls.resume()).toEqual({ ok: true });
    expect(controls.paused).toBe(false);
    expect(session.input.setAudioEnabled).toHaveBeenLastCalledWith(true);
    expect(coach.resumed).toHaveBeenCalledOnce();
    expect(events).toEqual([
      ['pause', {}],
      ['resume', { pausedMs: 12_000 }],
    ]);
    expect(controls.resume()).toEqual({ ok: true }); // not paused: nothing to do
    expect(events).toHaveLength(2);
  });

  it('refuses before she picks up, after the call, and in exam mode', () => {
    expect(setup({ phase: 'ringing' }).controls.pause()).toEqual({
      ok: false,
      reason: "She hasn't picked up yet.",
    });
    expect(setup({ phase: 'ended' }).controls.pause()).toEqual({
      ok: false,
      reason: 'The call is over.',
    });
    const exam = setup({ mode: 'exam' });
    expect(exam.controls.pause()).toEqual({ ok: false, reason: 'Pause is off in exam mode.' });
    expect(exam.session.input.setAudioEnabled).not.toHaveBeenCalled();
  });
});

describe('CallControls: hint (Get help)', () => {
  it('returns what to say and why, and logs it', async () => {
    const { controls, hints, events } = setup();
    await expect(controls.hint()).resolves.toEqual(HELP);
    expect(hints).toHaveBeenCalledWith({ system: 'You coach.', user: 'Rep: hi' });
    expect(events).toEqual([['hint', { ...HELP, ms: 1_400 }]]);
  });

  it('shares one Claude call between presses while it is on its way', async () => {
    const { controls, hints } = setup();
    const [a, b] = await Promise.all([controls.hint(), controls.hint()]);
    expect(a).toBe(b);
    expect(hints).toHaveBeenCalledOnce();
    await controls.hint();
    expect(hints).toHaveBeenCalledTimes(2);
  });

  it('fails with words the rep can read', async () => {
    const failing = setup();
    failing.hints.mockRejectedValueOnce(new HintError('Help came back empty. Try again.'));
    await expect(failing.controls.hint()).rejects.toThrow(
      new ControlError('Help came back empty. Try again.'),
    );
    failing.hints.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(failing.controls.hint()).rejects.toThrow("Couldn't get help. Try again.");
    await expect(setup({ mode: 'exam' }).controls.hint()).rejects.toThrow(
      'Help is off in exam mode.',
    );
  });
});

describe('CallControls: rewind', () => {
  it('cuts her conversation to before the rep’s last turn and has her say her line again', async () => {
    const { controls, agent, session, brain, coach, latency, rewindLog, events } = setup();
    const kept = agent.chatCtx.items.slice(0, 2);
    await expect(controls.rewind()).resolves.toEqual({ ok: true });

    expect(agent.lines).toEqual(['assistant: Claire Hughes.']);
    // Truncated, never edited: the earlier items are the very same objects.
    expect(agent.chatCtx.items).toEqual(kept);
    expect(agent.chatCtx.items[1]).toBe(kept[1]);
    expect(session.interrupt).toHaveBeenCalledOnce();
    expect(session.clearUserTurn).toHaveBeenCalledOnce();
    expect(brain.rewindTo).toHaveBeenCalledWith(1);
    expect(rewindLog).toHaveBeenCalledOnce();
    expect(coach.rewound).toHaveBeenCalledWith(1);
    expect(coach.turnsChanged).toHaveBeenCalledOnce();
    expect(latency.rewound).toHaveBeenCalledOnce();
    expect(events).toEqual([['rewind', { ...TAKEN, repTurn: 1 }]]);
    expect(session.say).toHaveBeenCalledWith('Claire Hughes.', { addToChatCtx: false });
  });

  it('waits for her cut-off reply to land in the conversation before cutting', async () => {
    const { controls, agent, session } = setup({
      lines: [
        ['assistant', 'Claire Hughes.'],
        ['user', 'Hi Claire, got a minute?'],
      ],
    });
    session.interrupt.mockImplementationOnce(() => ({
      // LiveKit commits her interrupted reply before the interruption settles.
      await: Promise.resolve().then(() => {
        agent.chatCtx.addMessage({ role: 'assistant', content: 'Not re', interrupted: true });
      }),
    }));
    await controls.rewind();
    expect(agent.lines).toEqual(['assistant: Claire Hughes.']);
  });

  it('takes back only the latest turn, and re-speaks the line that turn answered', async () => {
    const { controls, agent, session, brain } = setup({
      repTurns: 2,
      lines: [
        ['assistant', 'Claire Hughes.'],
        ['user', 'Got a minute?'],
        ['assistant', 'Barely. What is it?'],
        ['user', 'We sell dashboards.'],
        ['assistant', 'Not interested.'],
      ],
    });
    await controls.rewind();
    expect(agent.lines).toEqual([
      'assistant: Claire Hughes.',
      'user: Got a minute?',
      'assistant: Barely. What is it?',
    ]);
    expect(brain.rewindTo).toHaveBeenCalledWith(2);
    expect(session.say).toHaveBeenCalledWith('Barely. What is it?', { addToChatCtx: false });
  });

  it('resumes a paused call', async () => {
    const { controls, session, events } = setup();
    controls.pause();
    await controls.rewind();
    expect(controls.paused).toBe(false);
    expect(session.input.setAudioEnabled).toHaveBeenLastCalledWith(true);
    expect(events.map(([kind]) => kind)).toEqual(['pause', 'rewind', 'resume']);
  });

  it('refuses when there is nothing to take back, once a meeting is booked, and in exam mode', async () => {
    const early = setup({ repTurns: 0, lines: [['assistant', 'Claire Hughes.']] });
    await expect(early.controls.rewind()).resolves.toEqual({
      ok: false,
      reason: "There's no turn of yours to take back yet.",
    });
    expect(early.session.interrupt).not.toHaveBeenCalled();

    await expect(setup({ meeting: 'Tuesday at 10' }).controls.rewind()).resolves.toMatchObject({
      ok: false,
      reason: 'The meeting is booked, so there is nothing to take back.',
    });
    await expect(setup({ mode: 'exam' }).controls.rewind()).resolves.toEqual({
      ok: false,
      reason: 'Rewind is off in exam mode.',
    });
  });

  it('refuses a second rewind while the first is still settling', async () => {
    const { controls, session } = setup();
    let settle = () => {};
    session.interrupt.mockImplementationOnce(() => ({
      await: new Promise<void>((resolve) => {
        settle = resolve;
      }),
    }));
    const first = controls.rewind();
    await expect(controls.rewind()).resolves.toEqual({ ok: false, reason: 'Already rewinding.' });
    settle();
    await expect(first).resolves.toEqual({ ok: true });
  });
});

describe('CallControls: hang up', () => {
  it('ends the call as the rep’s hang-up, in exam mode too', () => {
    const { controls, controller } = setup({ mode: 'exam' });
    expect(controls.hangup()).toEqual({ ok: true });
    expect(controller.end).toHaveBeenCalledWith('ended_by_rep');
    const ended = setup({ phase: 'ended' });
    expect(ended.controls.hangup()).toEqual({ ok: true });
    expect(ended.controller.end).not.toHaveBeenCalled();
  });
});
