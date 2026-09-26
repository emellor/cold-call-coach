// The live coach (PLAN.md §8.1–8.2): the metrics panel about twice a second,
// the stage tracker and the judge's tips, for coached calls only. Exam calls
// publish nothing. It reads the call through what runCall feeds it and never
// touches the prospect's reply path.
import { type CallMode, type CallStage, type JudgeResult, Topics } from '@ccc/contracts';
import {
  type MetricTurn,
  NO_STAGES,
  NO_TURN_METRICS,
  type StageStatuses,
  TalkClock,
  TipGate,
  type TurnDerivedMetrics,
  computeMetrics,
  liveCoachMetrics,
  stageChanges,
  stageStatuses,
} from '@ccc/core';
import type { Publisher } from '../publisher.ts';

/** PLAN.md §8.1: about twice a second. */
export const METRICS_INTERVAL_MS = 500;

export interface LiveCoachOptions {
  mode: CallMode;
  publisher: Pick<Publisher, 'publish'>;
  /** The judge's stage for each judged rep turn so far, in order. */
  stages: () => readonly CallStage[];
  /**
   * How long after the rep stops the VAD says so (its minimum silence): the
   * rep's speech is taken to have ended that much before the state change.
   */
  repStopLagMs?: number;
  now?: () => number;
}

type UserState = 'speaking' | 'listening' | 'away';
type AgentState = 'initializing' | 'idle' | 'listening' | 'thinking' | 'speaking';

export class LiveCoach {
  readonly #options: LiveCoachOptions;
  readonly #now: () => number;
  readonly #clock = new TalkClock();
  readonly #tips: TipGate;
  #connectedAt: number | null = null;
  #timer: ReturnType<typeof setInterval> | undefined;
  #turnMetrics: TurnDerivedMetrics = NO_TURN_METRICS;
  #published: StageStatuses = NO_STAGES;
  #meetingBooked = false;
  #paused = false;
  #ended = false;

  constructor(options: LiveCoachOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#tips = new TipGate(options.mode);
  }

  get #on(): boolean {
    return this.#options.mode === 'coached' && this.#connectedAt !== null && !this.#ended;
  }

  /** She picked up: the clock starts, the tracker opens on the opener, metrics begin. */
  connected(): void {
    if (this.#options.mode !== 'coached' || this.#connectedAt !== null || this.#ended) return;
    this.#connectedAt = this.#now();
    this.#syncStages();
    this.#timer = setInterval(() => this.publishMetrics(), METRICS_INTERVAL_MS);
    this.#timer.unref?.();
  }

  /** The call is over: nothing more is published. */
  ended(): void {
    this.#ended = true;
    clearInterval(this.#timer);
  }

  /** LiveKit's user state (VAD): the rep started or stopped speaking. */
  userState(state: UserState, at: number): void {
    if (!this.#on || this.#paused) return;
    if (state === 'speaking') this.#clock.repStarted(at);
    else this.#clock.repStopped(at - (this.#options.repStopLagMs ?? 0));
    this.#afterSpeechChange(at);
  }

  /** LiveKit's agent state: she started or stopped speaking. */
  agentState(state: AgentState, at: number): void {
    if (!this.#on || this.#paused) return;
    if (state === 'speaking') this.#clock.prospectStarted(at);
    else this.#clock.prospectStopped(at);
    this.#afterSpeechChange(at);
  }

  /** The committed turns changed (a turn was added, or a rewind took some back). */
  turnsChanged(turns: readonly MetricTurn[]): void {
    if (this.#options.mode !== 'coached') return;
    const m = computeMetrics(turns, 0);
    this.#turnMetrics = {
      repWpm: m.repWpm,
      coreFillers: m.coreFillers,
      softFillers: m.softFillers,
      fillersPerMin: m.fillersPerMin,
      questionsOpen: m.questionsOpen,
      questionsClosed: m.questionsClosed,
    };
  }

  /** A rep turn was judged: move the tracker, and pass the tip through the gate. */
  judged(turn: number, judge: Pick<JudgeResult, 'tip'>): void {
    if (!this.#on) return;
    this.#syncStages();
    const tip = this.#tips.offer(judge.tip, turn, this.#now(), this.#clock.overlapping);
    if (tip) void this.#options.publisher.publish(Topics.coachTip, tip);
  }

  meetingBooked(): void {
    this.#meetingBooked = true;
    if (this.#on) this.#syncStages();
  }

  /** The rep took back turn `turn` and after: forget their tip, and step the tracker back. */
  rewound(turn: number): void {
    this.#tips.discardFrom(turn);
    if (this.#on) this.#syncStages();
  }

  /** Paused: nobody is speaking, whatever the VAD last said, until resumed. */
  paused(at: number): void {
    if (!this.#on) return;
    this.#clock.repStopped(at);
    this.#clock.prospectStopped(at);
    this.#paused = true;
    this.#afterSpeechChange(at);
  }

  resumed(): void {
    this.#paused = false;
  }

  publishMetrics(): void {
    if (!this.#on || this.#connectedAt === null) return;
    const now = this.#now();
    const payload = liveCoachMetrics({
      elapsedMs: now - this.#connectedAt,
      talk: this.#clock.snapshot(now),
      turns: this.#turnMetrics,
    });
    void this.#options.publisher.publish(Topics.coachMetrics, payload);
  }

  #afterSpeechChange(at: number): void {
    if (this.#clock.overlapping) return;
    const tip = this.#tips.release(at);
    if (tip) void this.#options.publisher.publish(Topics.coachTip, tip);
  }

  #syncStages(): void {
    const next = stageStatuses(this.#options.stages(), this.#meetingBooked);
    for (const change of stageChanges(this.#published, next)) {
      void this.#options.publisher.publish(Topics.coachStage, change);
    }
    this.#published = next;
  }
}
