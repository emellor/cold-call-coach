import type { ProspectState } from '@ccc/contracts';
import { describe, expect, it } from 'vitest';
import { clone, hardScenario, judged, scenario } from '../test/fixtures.ts';
import {
  HANG_UP_INSTRUCTION,
  applyJudgement,
  initialState,
  meetingAllowed,
  moodFor,
  recentMeetingAsk,
  shouldHangUp,
  stateToInstruction,
  wouldMeet,
} from './stateEngine.ts';

const calm = { longestMonologueSec: 10 };
const state = (patch: Partial<ProspectState> = {}): ProspectState => ({
  ...initialState(scenario),
  ...patch,
});

describe('initialState', () => {
  it("starts from the scenario's numbers with nothing revealed", () => {
    expect(initialState(scenario)).toEqual({
      turn: 0,
      interest: 20,
      patience: 55,
      painsRevealed: [],
    });
  });
});

describe('applyJudgement', () => {
  const apply = (s: ProspectState, signals: Parameters<typeof judged>[0], metrics = calm) =>
    applyJudgement(s, judged(signals), metrics, scenario);

  it('costs patience every turn and counts the turn', () => {
    expect(apply(state(), {})).toMatchObject({ turn: 1, interest: 20, patience: 52 });
  });

  it('rewards asking permission only in the first two turns', () => {
    expect(apply(state(), { askedPermission: true }).patience).toBe(62);
    expect(apply(state({ turn: 1 }), { askedPermission: true }).patience).toBe(62);
    expect(apply(state({ turn: 2 }), { askedPermission: true }).patience).toBe(52);
  });

  it.each([
    [{ gaveRelevantReason: true }, { interest: 30, patience: 52 }],
    [{ askedOpenQuestion: true }, { interest: 26, patience: 52 }],
    [{ followedUp: true }, { interest: 26, patience: 55 }],
    [{ acknowledgedObjection: true }, { interest: 20, patience: 57 }],
    [{ pitchedFeatures: true }, { interest: 20, patience: 44 }],
    [{ ignoredHerPoint: true }, { interest: 20, patience: 44 }],
    [{ pushy: true }, { interest: 20, patience: 37 }],
  ])('applies %o', (signals, expected) => {
    expect(apply(state(), signals)).toMatchObject(expected);
  });

  it('adds up several signals in one turn', () => {
    const next = apply(state(), { gaveRelevantReason: true, askedOpenQuestion: true, pushy: true });
    expect(next).toMatchObject({ interest: 36, patience: 37 });
  });

  it('punishes a feature pitch harder on a hard prospect', () => {
    const next = applyJudgement(
      initialState(hardScenario),
      judged({ pitchedFeatures: true }),
      calm,
      hardScenario,
    );
    expect(next.patience).toBe(35 - 5 - 12);
  });

  it('costs patience for a monologue over 45 seconds, and not at 45', () => {
    expect(apply(state(), {}, { longestMonologueSec: 45 }).patience).toBe(52);
    expect(apply(state(), {}, { longestMonologueSec: 45.5 }).patience).toBe(42);
  });

  it('keeps interest and patience within 0–100', () => {
    const high = apply(state({ interest: 98, patience: 99 }), {
      gaveRelevantReason: true,
      askedPermission: true,
    });
    expect(high).toMatchObject({ interest: 100, patience: 100 });
    const low = apply(state({ patience: 5 }), { pushy: true, ignoredHerPoint: true });
    expect(low.patience).toBe(0);
  });

  it('reveals an earned fact once, and ignores keys the scenario does not have', () => {
    const once = applyJudgement(state(), judged({}, { revealEarned: 'pain_2' }), calm, scenario);
    expect(once.painsRevealed).toEqual(['pain_2']);
    const twice = applyJudgement(once, judged({}, { revealEarned: 'pain_2' }), calm, scenario);
    expect(twice.painsRevealed).toEqual(['pain_2']);
    // The fixture has two pains, so there is no pain_3 to reveal.
    const unknown = applyJudgement(once, judged({}, { revealEarned: 'pain_3' }), calm, scenario);
    expect(unknown.painsRevealed).toEqual(['pain_2']);
  });

  it('never mutates the state it is given', () => {
    const before = state();
    const copy = clone(before);
    applyJudgement(before, judged({ rude: true }, { revealEarned: 'timing' }), calm, scenario);
    expect(before).toEqual(copy);
  });

  it('a run of bad turns drives patience down to the hang-up threshold', () => {
    const bad = judged({ pitchedFeatures: true, ignoredHerPoint: true });
    let s = initialState(hardScenario);
    const trace: number[] = [];
    while (!shouldHangUp(s, hardScenario) && s.turn < 20) {
      s = applyJudgement(s, bad, { longestMonologueSec: 50 }, hardScenario);
      trace.push(s.patience);
    }
    expect(trace).toEqual([0]); // 35 − 5 − 12 − 8 − 10: one rambling pitch is enough
    expect(shouldHangUp(s, hardScenario)).toBe(true);
    expect(stateToInstruction(s, hardScenario)).toContain(HANG_UP_INSTRUCTION);

    let medium = initialState(scenario);
    const mediumTrace: number[] = [];
    while (!shouldHangUp(medium, scenario) && medium.turn < 20) {
      medium = applyJudgement(medium, judged({ pitchedFeatures: true }), calm, scenario);
      mediumTrace.push(medium.patience);
    }
    expect(mediumTrace).toEqual([44, 33, 22, 11, 0]);
    expect(moodFor(medium)).toBe('angry');
  });

  it("'rude' ends the call, however well it was going", () => {
    const going = state({ turn: 4, interest: 80, patience: 90 });
    const after = applyJudgement(
      going,
      judged({ rude: true, gaveRelevantReason: true, followedUp: true }),
      calm,
      scenario,
    );
    expect(after.patience).toBe(0);
    expect(shouldHangUp(after, scenario)).toBe(true);
    expect(stateToInstruction(after, scenario)).toBe(
      `Private note for your next reply (never mention it):\n${HANG_UP_INSTRUCTION}`,
    );
    expect(
      meetingAllowed(after, { askedForMeeting: true, proposedSpecificTime: true }, scenario),
    ).toBe(false);
  });
});

describe('meetingAllowed', () => {
  const ready = state({ interest: 65 });
  const notReady = state({ interest: 64 });

  it.each([
    [ready, true, true, true],
    [ready, true, false, false],
    [ready, false, true, false],
    [ready, false, false, false],
    [notReady, true, true, false],
    [notReady, true, false, false],
    [notReady, false, true, false],
    [notReady, false, false, false],
  ])(
    'needs interest ≥ meetingAt AND askedForMeeting AND proposedSpecificTime (interest %#)',
    (s, askedForMeeting, proposedSpecificTime, allowed) => {
      expect(meetingAllowed(s, { askedForMeeting, proposedSpecificTime }, scenario)).toBe(allowed);
    },
  );

  it('is never allowed once she has run out of patience', () => {
    const spent = state({ interest: 90, patience: 0 });
    expect(wouldMeet(spent, scenario)).toBe(false);
  });
});

describe('recentMeetingAsk', () => {
  it('combines the ask and the time across the last three rep turns', () => {
    const asks = [
      judged({ askedForMeeting: true }),
      judged({}),
      judged({ proposedSpecificTime: true }),
    ];
    expect(recentMeetingAsk(asks)).toEqual({ askedForMeeting: true, proposedSpecificTime: true });
    expect(recentMeetingAsk([...asks, judged({}), judged({})])).toEqual({
      askedForMeeting: false,
      proposedSpecificTime: true,
    });
    expect(recentMeetingAsk([])).toEqual({ askedForMeeting: false, proposedSpecificTime: false });
  });
});

describe('moodFor', () => {
  it.each([
    [{ patience: 24, interest: 90 }, 'angry'],
    [{ patience: 25, interest: 60 }, 'happy'],
    [{ patience: 25, interest: 59 }, 'neutral'],
    [{ patience: 80, interest: 20 }, 'neutral'],
  ] as const)('%o → %s', (patch, mood) => {
    expect(moodFor(state(patch))).toBe(mood);
  });
});

describe('stateToInstruction', () => {
  const note = (patch: Partial<ProspectState>, facts = {}) =>
    stateToInstruction(state(patch), scenario, facts);

  it('describes patience in four bands', () => {
    expect(note({ patience: 60 })).toContain('Patience: plenty');
    expect(note({ patience: 59 })).toContain('Patience: some');
    expect(note({ patience: 34 })).toContain('Patience: little');
    expect(note({ patience: 0 })).toContain(HANG_UP_INSTRUCTION);
  });

  it('describes interest in plain words', () => {
    expect(note({ interest: 10 })).toContain('Interest: none yet');
    expect(note({ interest: 20 })).toContain('Interest: mildly curious');
    expect(note({ interest: 40 })).toContain('Interest: interested');
    expect(note({ interest: 60 })).toContain('Interest: keen');
  });

  it('names the private facts she may now discuss, in her words', () => {
    expect(note({})).toContain('Private facts: none earned yet');
    const text = note({ painsRevealed: ['pain_1', 'timing'] });
    expect(text).toContain(
      'Private facts you may now discuss: energy bills up about 40% in two years and the board wants answers; budget planning starts in January.',
    );
    expect(text).not.toContain('per-site breakdown');
  });

  it('says whether she would take a specific meeting ask now', () => {
    expect(note({ interest: 65 })).toContain(
      'you would accept one if they propose a specific day and time',
    );
    expect(note({ interest: 64 })).toContain("you wouldn't agree to one yet");
  });

  it('holds her to a booked meeting, and corrects one that did not count', () => {
    expect(note({ interest: 70 }, { meetingBooked: 'Tuesday at 10am' })).toContain(
      "you've already agreed to Tuesday at 10am",
    );
    expect(note({ interest: 70 }, { meetingNotBooked: true })).toContain(
      'make them name a specific day and time',
    );
    expect(note({ interest: 30 }, { meetingNotBooked: true })).toContain(
      "you're not convinced enough to meet",
    );
  });

  it('only forces the goodbye once patience is gone', () => {
    expect(note({ patience: 1 })).not.toContain('end_call');
    expect(note({ patience: 0, interest: 90 }, { meetingBooked: 'Friday at 2' })).not.toContain(
      'Meeting',
    );
  });
});
