import type { JudgeResult, ProspectStatePayload } from '@ccc/contracts';
import { HANG_UP_INSTRUCTION, type TranscriptTurn } from '@ccc/core';
import { describe, expect, it, vi } from 'vitest';
import type { Judge } from '../judge/judge.ts';
import { judged, product, scenario, silentLogger } from '../test/fixtures.ts';
import { type JudgedTurn, NO_JUDGEMENT, ProspectBrain } from './brain.ts';

const calm = { longestMonologueSec: 10 };
const talk = (...lines: string[]): TranscriptTurn[] =>
  lines.map((text, i) => ({ speaker: i % 2 === 0 ? 'prospect' : 'rep', text }));

/** A judge whose answers the test releases one by one, in any order. */
function manualJudge() {
  const pending: Array<{ user: string; resolve: (r: JudgeResult | null) => void }> = [];
  const judge: Judge = ({ user }) =>
    new Promise((resolve) => {
      pending.push({ user, resolve });
    });
  return { judge, pending };
}

const brainWith = (judge: Judge, onState = vi.fn()) =>
  new ProspectBrain({ scenario, product, judge, logger: silentLogger, onState });

describe('ProspectBrain', () => {
  it('starts from the scenario and publishes nothing until a turn is judged', () => {
    const onState = vi.fn();
    const brain = brainWith(() => Promise.resolve(judged()), onState);
    expect(brain.state).toEqual({ turn: 0, interest: 20, patience: 55, painsRevealed: [] });
    expect(brain.statePayload()).toEqual({ turn: 0, mood: 'neutral', interest: 20, patience: 55 });
    expect(onState).not.toHaveBeenCalled();
  });

  it('gives the judge the product, her facts and the latest rep turn', async () => {
    const judge = vi.fn<Judge>(() => Promise.resolve(judged()));
    const brain = brainWith(judge);
    brain.repTurn(talk('Claire Hughes.', 'Hi Claire, Sam from WattGuard.'), calm);
    await brain.settled();
    const [{ system, user }] = judge.mock.calls[0]!;
    expect(system).toContain('WattGuard');
    expect(system).toContain('- pain_1: energy bills up about 40%');
    expect(user).toContain('LATEST Rep: Hi Claire, Sam from WattGuard.');
    expect(user).toContain('interest 20/100, patience 55/100');
  });

  it('applies judgements in turn order even when they finish out of order', async () => {
    const { judge, pending } = manualJudge();
    const onState = vi.fn<(payload: ProspectStatePayload) => void>();
    const brain = brainWith(judge, onState);
    const first = brain.repTurn(talk('Claire Hughes.', 'Got thirty seconds?'), calm);
    const second = brain.repTurn(
      talk('Claire Hughes.', 'Got thirty seconds?', 'Go on.', 'Energy?'),
      calm,
    );
    expect([first, second]).toEqual([1, 2]);

    // Only the first judgement has started: the second waits for the state it produces.
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending[0]!.resolve(judged({ askedPermission: true, gaveRelevantReason: true }));
    await brain.judged(1);
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[1]!.user).toContain('interest 30/100, patience 62/100');

    pending[1]!.resolve(judged({ askedOpenQuestion: true }, { revealEarned: 'pain_1' }));
    await brain.settled();
    expect(brain.state).toEqual({ turn: 2, interest: 36, patience: 59, painsRevealed: ['pain_1'] });
    expect(onState.mock.calls.map(([payload]) => payload)).toEqual([
      { turn: 1, mood: 'neutral', interest: 30, patience: 62 },
      { turn: 2, mood: 'neutral', interest: 36, patience: 59 },
    ]);
    expect(brain.note()).toContain('Private facts you may now discuss: energy bills up about 40%');
  });

  it('reports every judgement in full, for the call log', async () => {
    const onJudged = vi.fn();
    const brain = new ProspectBrain({
      scenario,
      product,
      judge: () => Promise.resolve(judged({ gaveRelevantReason: true }, { stage: 'reason' })),
      logger: silentLogger,
      onJudged,
    });
    brain.repTurn(talk('Claire Hughes.', 'Energy bills keep FDs up at night.'), calm);
    await brain.settled();
    expect(onJudged).toHaveBeenCalledOnce();
    const [record] = onJudged.mock.calls[0] as [JudgedTurn];
    expect(record).toMatchObject({ turn: 1, judged: true, judge: { stage: 'reason' } });
    expect([record.before.interest, record.after.interest]).toEqual([20, 30]);
  });

  it('still costs her patience when the judge fails, and says so in the history', async () => {
    const brain = brainWith(() => Promise.resolve(null));
    brain.repTurn(talk('Claire Hughes.', 'Hello?'), calm);
    await brain.settled();
    expect(brain.state.patience).toBe(52);
    expect(brain.history[0]).toMatchObject({ turn: 1, judged: false, judge: NO_JUDGEMENT });

    const throwing = brainWith(() => Promise.reject(new Error('overloaded')));
    throwing.repTurn(talk('Claire Hughes.', 'Hello?'), calm);
    await throwing.settled();
    expect(throwing.history[0]?.judged).toBe(false);
  });

  it('turns rudeness into a goodbye on her next reply', async () => {
    const brain = brainWith(() => Promise.resolve(judged({ rude: true })));
    expect(brain.hangUpDue).toBe(false);
    brain.repTurn(talk('Claire Hughes.', 'Just listen, love.'), calm);
    await brain.settled();
    expect(brain.hangUpDue).toBe(true);
    expect(brain.note()).toContain(HANG_UP_INSTRUCTION);
    expect(brain.statePayload().mood).toBe('angry');
  });

  it('costs patience for a long monologue', async () => {
    const brain = brainWith(() => Promise.resolve(judged()));
    brain.repTurn(talk('Claire Hughes.', 'So basically...'), { longestMonologueSec: 60 });
    await brain.settled();
    expect(brain.state.patience).toBe(42);
  });

  describe('agreeToMeeting', () => {
    /** A brain whose judge returns the given results in order, at the given starting interest. */
    async function playedOut(results: JudgeResult[], interest = 70) {
      const queue = [...results];
      const brain = new ProspectBrain({
        scenario: { ...scenario, state: { ...scenario.state, interest } },
        product,
        judge: () => Promise.resolve(queue.shift() ?? judged()),
        logger: silentLogger,
      });
      for (let i = 0; i < results.length; i++)
        brain.repTurn(talk('Claire Hughes.', `turn ${i}`), calm);
      await brain.settled();
      return brain;
    }

    it('books a meeting the rep asked for at a specific time once she was interested enough', async () => {
      const brain = await playedOut([
        judged({ followedUp: true }),
        judged({ askedForMeeting: true, proposedSpecificTime: true }),
      ]);
      await expect(brain.agreeToMeeting('Tuesday at 10am', 2)).resolves.toEqual({
        booked: true,
        when: 'Tuesday at 10am',
      });
      expect(brain.meeting).toBe('Tuesday at 10am');
      expect(brain.note()).toContain("you've already agreed to Tuesday at 10am");
    });

    it('accepts the ask and the time from different recent turns', async () => {
      const brain = await playedOut([
        judged({ askedForMeeting: true }),
        judged({ proposedSpecificTime: true }),
      ]);
      expect((await brain.agreeToMeeting('Thursday at 2pm', 2)).booked).toBe(true);
    });

    it('refuses without a specific time, and her next note says nothing is agreed', async () => {
      const brain = await playedOut([judged({ askedForMeeting: true })]);
      await expect(brain.agreeToMeeting('next week sometime', 1)).resolves.toEqual({
        booked: false,
        reason: 'the rep never proposed a specific day and time',
      });
      expect(brain.meeting).toBeNull();
      expect(brain.note()).toContain('Meeting: nothing is agreed yet');
    });

    it('refuses when the rep never asked', async () => {
      const brain = await playedOut([judged({ proposedSpecificTime: true })]);
      expect(await brain.agreeToMeeting('Friday at 9', 1)).toEqual({
        booked: false,
        reason: 'the rep never asked for a meeting',
      });
    });

    it('refuses when she was not interested enough when she replied', async () => {
      const brain = await playedOut(
        [judged({ askedForMeeting: true, proposedSpecificTime: true, gaveRelevantReason: true })],
        60,
      );
      expect(await brain.agreeToMeeting('Friday at 9', 1)).toEqual({
        booked: false,
        reason: 'she was not interested enough yet',
      });
    });

    it('waits for the judgement of the turn she was answering', async () => {
      const { judge, pending } = manualJudge();
      const brain = new ProspectBrain({
        scenario: { ...scenario, state: { ...scenario.state, interest: 70 } },
        product,
        judge,
        logger: silentLogger,
      });
      brain.repTurn(talk('Claire Hughes.', 'Tuesday at ten?'), calm);
      const decision = brain.agreeToMeeting('Tuesday at 10am', 1);
      await vi.waitFor(() => expect(pending).toHaveLength(1));
      pending[0]!.resolve(judged({ askedForMeeting: true, proposedSpecificTime: true }));
      expect((await decision).booked).toBe(true);
    });

    it('trusts her on the ask when that turn could not be judged', async () => {
      const brain = await playedOut([]);
      const failing = new ProspectBrain({
        scenario: { ...scenario, state: { ...scenario.state, interest: 70 } },
        product,
        judge: () => Promise.resolve(null),
        logger: silentLogger,
      });
      failing.repTurn(talk('Claire Hughes.', 'Tuesday at ten?'), calm);
      expect((await failing.agreeToMeeting('Tuesday at 10am', 1)).booked).toBe(true);
      expect((await brain.agreeToMeeting('Tuesday', 0)).booked).toBe(false);
    });

    it('keeps the first booked slot', async () => {
      const brain = await playedOut([
        judged({ askedForMeeting: true, proposedSpecificTime: true }),
      ]);
      await brain.agreeToMeeting('Tuesday at 10am', 1);
      expect(await brain.agreeToMeeting('Wednesday at 3pm', 1)).toEqual({
        booked: true,
        when: 'Tuesday at 10am',
      });
    });
  });

  describe('rewindTo', () => {
    it('restores her state from before the turn, and the retake gets its number', async () => {
      const queue = [
        judged({ gaveRelevantReason: true }, { stage: 'reason' }),
        judged({ pushy: true }, { stage: 'close' }),
      ];
      const onState = vi.fn<(payload: ProspectStatePayload) => void>();
      const brain = brainWith(() => Promise.resolve(queue.shift() ?? judged()), onState);
      brain.repTurn(talk('Claire Hughes.', 'Energy bills?'), calm);
      brain.repTurn(talk('Claire Hughes.', 'Energy bills?', 'Go on.', 'Book it now.'), calm);
      await brain.settled();
      const afterFirst = brain.history[0]!.after;
      expect(brain.stages).toEqual(['reason', 'close']);

      brain.rewindTo(2);
      expect(brain.state).toEqual(afterFirst);
      expect(brain.repTurns).toBe(1);
      expect(brain.stages).toEqual(['reason']);
      expect(onState).toHaveBeenLastCalledWith(brain.statePayload());
      expect(
        brain.repTurn(talk('Claire Hughes.', 'Energy bills?', 'Go on.', 'How so?'), calm),
      ).toBe(2);
    });

    it('discards a judgement still running for the rewound turn', async () => {
      const { judge, pending } = manualJudge();
      const onJudged = vi.fn();
      const brain = new ProspectBrain({ scenario, product, judge, logger: silentLogger, onJudged });
      brain.repTurn(talk('Claire Hughes.', 'You must be busy.'), calm);
      await vi.waitFor(() => expect(pending).toHaveLength(1));
      brain.rewindTo(1);
      pending[0]!.resolve(judged({ rude: true }));
      await brain.settled();
      expect(brain.state).toEqual({ turn: 0, interest: 20, patience: 55, painsRevealed: [] });
      expect(brain.history).toEqual([]);
      expect(onJudged).not.toHaveBeenCalled();
      await expect(brain.judged(1)).resolves.toBeUndefined();
    });

    it('never asks the judge about a rewound turn still waiting in the queue', async () => {
      const { judge, pending } = manualJudge();
      const brain = brainWith(judge);
      brain.repTurn(talk('Claire Hughes.', 'Got a minute?'), calm);
      brain.repTurn(talk('Claire Hughes.', 'Got a minute?', 'Go on.', 'Buy now.'), calm);
      brain.rewindTo(2);
      await vi.waitFor(() => expect(pending).toHaveLength(1));
      pending[0]!.resolve(judged({ askedPermission: true }));
      await brain.settled();
      expect(pending).toHaveLength(1);
      expect(brain.history.map((t) => t.turn)).toEqual([1]);
    });

    it('forgets a meeting refusal made in reply to the rewound turn', async () => {
      const brain = brainWith(() => Promise.resolve(judged({ askedForMeeting: true })));
      brain.repTurn(talk('Claire Hughes.', 'Can we meet?'), calm);
      await brain.settled();
      await brain.agreeToMeeting('next week', 1);
      expect(brain.note()).toContain('Meeting: nothing is agreed yet');
      brain.rewindTo(1);
      expect(brain.note()).not.toContain('Meeting: nothing is agreed yet');
    });

    it('stands down a meeting decision that was waiting on the rewound turn', async () => {
      const { judge, pending } = manualJudge();
      const brain = new ProspectBrain({
        scenario: { ...scenario, state: { ...scenario.state, interest: 70 } },
        product,
        judge,
        logger: silentLogger,
      });
      brain.repTurn(talk('Claire Hughes.', 'Tuesday at ten?'), calm);
      const decision = brain.agreeToMeeting('Tuesday at 10am', 1);
      await vi.waitFor(() => expect(pending).toHaveLength(1));
      brain.rewindTo(1);
      pending[0]!.resolve(judged({ askedForMeeting: true, proposedSpecificTime: true }));
      await expect(decision).resolves.toEqual({
        booked: false,
        reason: 'the rep rewound that turn',
      });
      expect(brain.meeting).toBeNull();
      expect(brain.note()).not.toContain('Meeting: nothing is agreed yet');
    });

    it('ignores a turn that does not exist', async () => {
      const brain = brainWith(() => Promise.resolve(judged()));
      brain.repTurn(talk('Claire Hughes.', 'Hi.'), calm);
      await brain.settled();
      const before = brain.state;
      brain.rewindTo(0);
      brain.rewindTo(2);
      expect(brain.state).toBe(before);
      expect(brain.repTurns).toBe(1);
    });
  });
});
