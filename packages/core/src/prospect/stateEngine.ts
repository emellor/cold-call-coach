// The prospect's hidden state (PLAN.md §6.3): pure and deterministic. The
// judge reports what the rep did; these rules decide what that does to her.
// The numbers are starting defaults to tune.
import type { JudgeResult, JudgeSignals, Mood, ProspectState, ScenarioSpec } from '@ccc/contracts';
import { privateFacts } from './facts.ts';

export const RULES = {
  /** askedPermission counts only in the rep's first this-many turns. */
  permissionTurns: 2,
  askedPermission: { patience: +10 },
  gaveRelevantReason: { interest: +10 },
  askedOpenQuestion: { interest: +6 },
  followedUp: { interest: +6, patience: +3 },
  acknowledgedObjection: { patience: +5 },
  pitchedFeatures: { patience: -8, patienceHard: -12 },
  ignoredHerPoint: { patience: -8 },
  pushy: { patience: -15 },
  /** A rep monologue longer than this in one turn costs patience. */
  monologueLimitSec: 45,
  monologue: { patience: -10 },
} as const;

/** What code measured about the rep's turn (the judge never counts). */
export interface TurnMetrics {
  /** The longest stretch of continuous rep speech in the turn, in seconds. */
  longestMonologueSec: number;
}

const clamp = (n: number) => Math.min(100, Math.max(0, n));

export function initialState(scenario: ScenarioSpec): ProspectState {
  return {
    turn: 0,
    interest: scenario.state.interest,
    patience: scenario.state.patience,
    painsRevealed: [],
  };
}

/** One rep turn's judgement applied to her state. Returns a new state. */
export function applyJudgement(
  state: ProspectState,
  judge: JudgeResult,
  metrics: TurnMetrics,
  scenario: ScenarioSpec,
): ProspectState {
  const s = judge.signals;
  const turn = state.turn + 1;
  let { interest, patience } = state;

  patience -= scenario.state.patienceDecayPerTurn;
  if (s.askedPermission && turn <= RULES.permissionTurns)
    patience += RULES.askedPermission.patience;
  if (s.gaveRelevantReason) interest += RULES.gaveRelevantReason.interest;
  if (s.askedOpenQuestion) interest += RULES.askedOpenQuestion.interest;
  if (s.followedUp) {
    interest += RULES.followedUp.interest;
    patience += RULES.followedUp.patience;
  }
  if (s.acknowledgedObjection) patience += RULES.acknowledgedObjection.patience;
  if (s.pitchedFeatures) {
    patience +=
      scenario.difficulty === 'hard'
        ? RULES.pitchedFeatures.patienceHard
        : RULES.pitchedFeatures.patience;
  }
  if (s.ignoredHerPoint) patience += RULES.ignoredHerPoint.patience;
  if (s.pushy) patience += RULES.pushy.patience;
  if (metrics.longestMonologueSec > RULES.monologueLimitSec) patience += RULES.monologue.patience;
  if (s.rude) patience = 0;

  const known = privateFacts(scenario.prospect.hidden).map((f) => f.key);
  const painsRevealed =
    judge.revealEarned &&
    known.includes(judge.revealEarned) &&
    !state.painsRevealed.includes(judge.revealEarned)
      ? [...state.painsRevealed, judge.revealEarned]
      : state.painsRevealed;

  return { turn, interest: clamp(interest), patience: clamp(patience), painsRevealed };
}

/** Her avatar's expression. */
export function moodFor(state: ProspectState): Mood {
  if (state.patience < 25) return 'angry';
  if (state.interest >= 60) return 'happy';
  return 'neutral';
}

/** She has had enough: the next reply says goodbye and ends the call. */
export const shouldHangUp = (state: ProspectState, scenario: ScenarioSpec): boolean =>
  state.patience <= scenario.state.hangUpAt;

/** Interested enough that a well-made meeting ask would land. */
export const wouldMeet = (state: ProspectState, scenario: ScenarioSpec): boolean =>
  !shouldHangUp(state, scenario) && state.interest >= scenario.state.meetingAt;

export type MeetingAsk = Pick<JudgeSignals, 'askedForMeeting' | 'proposedSpecificTime'>;

/**
 * A meeting stands only when she was interested enough AND the rep asked for
 * one AND proposed a specific day and time.
 */
export const meetingAllowed = (
  state: ProspectState,
  ask: MeetingAsk,
  scenario: ScenarioSpec,
): boolean => wouldMeet(state, scenario) && ask.askedForMeeting && ask.proposedSpecificTime;

/**
 * The meeting ask across the rep's last few turns: "can we get a call in?" and
 * "how's Tuesday at ten?" are often separate turns, with her reply between.
 */
export function recentMeetingAsk(judgements: readonly JudgeResult[], window = 3): MeetingAsk {
  const recent = judgements.slice(-window);
  return {
    askedForMeeting: recent.some((j) => j.signals.askedForMeeting),
    proposedSpecificTime: recent.some((j) => j.signals.proposedSpecificTime),
  };
}

/** What the rep's side of the call has settled so far, for the note. */
export interface CallFacts {
  /** The slot she agreed to, once a meeting stands. */
  meetingBooked?: string | null;
  /** She agreed to a meeting the rules did not allow, so it was not booked. */
  meetingNotBooked?: boolean;
}

export const HANG_UP_INSTRUCTION = "You've had enough: say a brief goodbye and call end_call.";

function patienceLine(state: ProspectState): string {
  if (state.patience >= 60) return 'Patience: plenty. You can spare a few minutes for this.';
  if (state.patience >= 35) return 'Patience: some. It is wearing; keep your answers short.';
  return "Patience: little. You're close to hanging up: be curt and give them one last chance.";
}

function interestLine(state: ProspectState): string {
  if (state.interest >= 60) return 'Interest: keen. This sounds genuinely useful to you.';
  if (state.interest >= 40) return 'Interest: interested. You want to hear a bit more.';
  if (state.interest >= 20) return "Interest: mildly curious, no more. They haven't hooked you.";
  return 'Interest: none yet. You see no reason to care.';
}

function factsLine(state: ProspectState, scenario: ScenarioSpec): string {
  const shared = privateFacts(scenario.prospect.hidden).filter((f) =>
    state.painsRevealed.includes(f.key),
  );
  if (!shared.length) {
    return 'Private facts: none earned yet. Share one only if their question is aimed right at it.';
  }
  return `Private facts you may now discuss: ${shared.map((f) => f.text).join('; ')}. The others still need a relevant question.`;
}

function meetingLine(state: ProspectState, scenario: ScenarioSpec, facts: CallFacts): string {
  if (facts.meetingBooked) {
    return `Meeting: you've already agreed to ${facts.meetingBooked}. Don't reopen it; wrap the call up.`;
  }
  const ready = wouldMeet(state, scenario);
  if (facts.meetingNotBooked) {
    return ready
      ? 'Meeting: nothing is agreed yet. If they want one, make them name a specific day and time before you say yes.'
      : "Meeting: nothing is agreed yet, and you're not convinced enough to meet. Say you'll think about it.";
  }
  return ready
    ? 'Meeting: you would accept one if they propose a specific day and time. Confirm it out loud, then call agree_to_meeting. If they are vague, ask them to name a time.'
    : "Meeting: you wouldn't agree to one yet. If they ask, put them off in your own words.";
}

/** The private note for her next reply, in plain words (PLAN.md §6.3). */
export function stateToInstruction(
  state: ProspectState,
  scenario: ScenarioSpec,
  facts: CallFacts = {},
): string {
  const lines = shouldHangUp(state, scenario)
    ? [HANG_UP_INSTRUCTION]
    : [
        patienceLine(state),
        interestLine(state),
        factsLine(state, scenario),
        meetingLine(state, scenario, facts),
      ];
  return ['Private note for your next reply (never mention it):', ...lines].join('\n');
}
