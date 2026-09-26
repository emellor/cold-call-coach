// The prospect's hidden side for one call: her state, the queue of judgements
// that move it, and the meeting rules. It knows nothing of LiveKit, so
// scripts/simulate-call.ts drives exactly the same logic as a real call.
import type {
  CallStage,
  JudgeResult,
  ProductSpec,
  ProspectState,
  ProspectStatePayload,
  ScenarioSpec,
} from '@ccc/contracts';
import {
  type TranscriptTurn,
  type TurnMetrics,
  applyJudgement,
  buildJudgeSystemPrompt,
  buildJudgeUserPrompt,
  initialState,
  meetingAllowed,
  moodFor,
  recentMeetingAsk,
  shouldHangUp,
  stateToInstruction,
  wouldMeet,
} from '@ccc/core';
import type { Judge } from '../judge/judge.ts';

/** Stands in when no judgement could be had: the turn still costs her patience. */
export const NO_JUDGEMENT: JudgeResult = {
  stage: 'other',
  revealEarned: null,
  tip: null,
  signals: {
    askedPermission: false,
    gaveRelevantReason: false,
    askedOpenQuestion: false,
    followedUp: false,
    acknowledgedObjection: false,
    pitchedFeatures: false,
    ignoredHerPoint: false,
    pushy: false,
    rude: false,
    askedForMeeting: false,
    proposedSpecificTime: false,
  },
};

export interface JudgedTurn {
  /** The rep turn, counting from 1. */
  turn: number;
  judge: JudgeResult;
  /** False when the judge failed and NO_JUDGEMENT was applied instead. */
  judged: boolean;
  before: ProspectState;
  after: ProspectState;
}

export type MeetingDecision = { booked: true; when: string } | { booked: false; reason: string };

export interface BrainLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface ProspectBrainOptions {
  scenario: ScenarioSpec;
  product: ProductSpec;
  judge: Judge;
  logger: BrainLogger;
  /** After every state change: publish `prospect.state`. */
  onState?: (payload: ProspectStatePayload) => void;
  /** After every judgement, with the whole record (the call log keeps it). */
  onJudged?: (turn: JudgedTurn) => void;
}

/** A queued judgement; a rewind cancels the ones for the turns it takes back. */
interface Ticket {
  cancelled: boolean;
}

export class ProspectBrain {
  readonly #options: ProspectBrainOptions;
  readonly #judgeSystem: string;
  #state: ProspectState;
  #repTurns = 0;
  #queue: Promise<unknown> = Promise.resolve();
  readonly #pending = new Map<number, Promise<JudgedTurn | undefined>>();
  readonly #tickets = new Map<number, Ticket>();
  #history: JudgedTurn[] = [];
  #meeting: string | null = null;
  /** The rep turn whose reply she agreed to a meeting in, when the rules refused it. */
  #meetingNotBookedAt: number | null = null;
  #rewinds = 0;

  constructor(options: ProspectBrainOptions) {
    this.#options = options;
    this.#state = initialState(options.scenario);
    this.#judgeSystem = buildJudgeSystemPrompt(options.scenario, options.product);
  }

  get state(): ProspectState {
    return this.#state;
  }

  /** Rep turns seen so far; the reply being spoken answers the latest. */
  get repTurns(): number {
    return this.#repTurns;
  }

  /** The agreed slot, once a meeting stands. */
  get meeting(): string | null {
    return this.#meeting;
  }

  /** Her patience has run out: the next reply is her goodbye. */
  get hangUpDue(): boolean {
    return shouldHangUp(this.#state, this.#options.scenario);
  }

  /** Every judged turn so far, in order. */
  get history(): readonly JudgedTurn[] {
    return this.#history;
  }

  /** The judge's stage for each judged turn, in order: the live stage tracker's input. */
  get stages(): CallStage[] {
    return this.#history.map((t) => t.judge.stage);
  }

  /** The private note for her next reply. */
  note(): string {
    return stateToInstruction(this.#state, this.#options.scenario, {
      meetingBooked: this.#meeting,
      meetingNotBooked: this.#meetingNotBookedAt !== null,
    });
  }

  statePayload(): ProspectStatePayload {
    const { turn, interest, patience } = this.#state;
    return {
      turn,
      mood: moodFor(this.#state),
      interest: Math.round(interest),
      patience: Math.round(patience),
    };
  }

  /**
   * A rep turn was committed; `turns` is the conversation up to and including
   * it. Its judgement is queued behind any still running, so the state moves in
   * turn order and the result shapes her NEXT reply (PLAN.md §6.3). Never
   * awaited on the reply path. Returns the rep turn's number.
   */
  repTurn(turns: readonly TranscriptTurn[], metrics: TurnMetrics): number {
    const turn = ++this.#repTurns;
    const ticket: Ticket = { cancelled: false };
    this.#tickets.set(turn, ticket);
    const task = this.#queue.then(() => this.#judge(turn, turns, metrics, ticket));
    this.#queue = task.catch(() => undefined);
    this.#pending.set(turn, task);
    return turn;
  }

  /** Resolves once rep turn `turn` has been judged and applied (undefined if it was rewound). */
  judged(turn: number): Promise<JudgedTurn | undefined> {
    return this.#pending.get(turn) ?? Promise.resolve(undefined);
  }

  /** Resolves when every queued judgement has been applied. */
  async settled(): Promise<void> {
    await this.#queue;
  }

  /**
   * Rewind (PLAN.md §8.3): takes back rep turn `turn` and any after it. Their
   * judgements are discarded, even one still running, and her state goes back
   * to what it was before `turn`, so the retake is judged from there and gets
   * the same turn number. A meeting refusal from those turns is forgotten too.
   */
  rewindTo(turn: number): void {
    if (turn < 1 || turn > this.#repTurns) return;
    this.#rewinds += 1;
    for (const [t, ticket] of this.#tickets) {
      if (t < turn) continue;
      ticket.cancelled = true;
      this.#tickets.delete(t);
      this.#pending.delete(t);
    }
    const first = this.#history.find((t) => t.turn >= turn);
    if (first) this.#state = first.before;
    this.#history = this.#history.filter((t) => t.turn < turn);
    this.#repTurns = turn - 1;
    if (this.#meetingNotBookedAt !== null && this.#meetingNotBookedAt >= turn) {
      this.#meetingNotBookedAt = null;
    }
    this.#options.logger.info({ turn, state: this.#state }, 'rewound');
    this.#options.onState?.(this.statePayload());
  }

  async #judge(
    turn: number,
    turns: readonly TranscriptTurn[],
    metrics: TurnMetrics,
    ticket: Ticket,
  ): Promise<JudgedTurn | undefined> {
    const { scenario, judge, logger, onState, onJudged } = this.#options;
    // Taken back while it waited in the queue: don't spend a Claude call on it.
    if (ticket.cancelled) return undefined;
    const before = this.#state;
    let result: JudgeResult | null = null;
    try {
      result = await judge({
        system: this.#judgeSystem,
        user: buildJudgeUserPrompt({ turns, state: before }),
      });
    } catch (error) {
      logger.warn({ err: error, turn }, 'judge threw; applying no judgement');
    }
    if (ticket.cancelled) {
      logger.info({ turn }, 'judgement of a rewound turn discarded');
      return undefined;
    }
    this.#tickets.delete(turn);
    const applied = result ?? NO_JUDGEMENT;
    const after = applyJudgement(before, applied, metrics, scenario);
    this.#state = after;
    const record: JudgedTurn = { turn, judge: applied, judged: result !== null, before, after };
    this.#history.push(record);
    logger.info(
      {
        turn,
        judged: record.judged,
        stage: applied.stage,
        signals: Object.entries(applied.signals)
          .filter(([, on]) => on)
          .map(([name]) => name),
        revealEarned: applied.revealEarned,
        interest: [before.interest, after.interest],
        patience: [before.patience, after.patience],
      },
      'rep turn judged',
    );
    onJudged?.(record);
    onState?.(this.statePayload());
    return record;
  }

  /**
   * She called agree_to_meeting in her reply to rep turn `turn`. The meeting
   * stands only if PLAN.md §6.3 allows it: she was interested enough when she
   * replied, and within the rep's last few turns they asked for a meeting and
   * proposed a specific day and time. Otherwise her next note says nothing is
   * agreed yet, and she can put it right on the next turn.
   */
  async agreeToMeeting(when: string, turn: number): Promise<MeetingDecision> {
    const rewinds = this.#rewinds;
    const record = await this.judged(turn);
    if (this.#meeting) return { booked: true, when: this.#meeting };
    // The rep rewound while this waited: the turn she agreed in is gone.
    if (this.#rewinds !== rewinds) return { booked: false, reason: 'the rep rewound that turn' };
    const { scenario } = this.#options;
    if (!record) return this.#notBooked(turn, 'she agreed before the rep had said anything');

    const ask = recentMeetingAsk(
      this.#history.filter((t) => t.turn <= turn && t.judged).map((t) => t.judge),
    );
    // With no judgement for the turn itself, trust her on the ask; the interest rule still holds.
    const allowed = record.judged
      ? meetingAllowed(record.before, ask, scenario)
      : wouldMeet(record.before, scenario);
    if (allowed) {
      this.#meeting = when;
      this.#meetingNotBookedAt = null;
      return { booked: true, when };
    }
    if (!wouldMeet(record.before, scenario)) {
      return this.#notBooked(turn, 'she was not interested enough yet');
    }
    return this.#notBooked(
      turn,
      ask.askedForMeeting
        ? 'the rep never proposed a specific day and time'
        : 'the rep never asked for a meeting',
    );
  }

  #notBooked(turn: number, reason: string): MeetingDecision {
    this.#meetingNotBookedAt = turn;
    return { booked: false, reason };
  }
}
