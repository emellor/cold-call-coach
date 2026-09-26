// Builds the call log (PLAN.md §10) as the call happens: every committed turn
// with its timing, the rep's word timings from Deepgram, events, latency and
// Claude usage per lane. Knows nothing of LiveKit; runCall feeds it.
import type {
  CallLog,
  CallOutcome,
  DebugLatencyPayload,
  EventKind,
  LaneUsage,
  LoggedEvent,
  LoggedTurn,
  ProspectState,
  RewindEventPayload,
  TimedWord,
} from '@ccc/contracts';
import { type MetricTurn, type TokenUsage, costUsd } from '@ccc/core';

/** A word from a final STT result: seconds on the STT stream's own clock. */
export interface SttWord {
  text: string;
  startTime?: number;
  endTime?: number;
}

export interface TurnTiming {
  /** Wall-clock seconds, from LiveKit's message metrics. */
  startedSpeakingAt?: number;
  stoppedSpeakingAt?: number;
  /** Wall-clock milliseconds the message was committed, if the metrics are missing. */
  committedAt: number;
}

type Lane = 'prospect' | 'judge' | 'hint';
const LANES: readonly Lane[] = ['prospect', 'judge', 'hint'];

interface RecordedTurn extends Omit<LoggedTurn, 'stateAfter'> {
  /** The brain's number for a rep turn, to find its judged state at the end. */
  repTurn?: number;
  stateAfter: ProspectState | null;
}

const toMs = (seconds: number) => Math.round(seconds * 1000);

export class CallRecorder {
  readonly #now: () => number;
  #connectedAt: number | null = null;
  readonly #turns: RecordedTurn[] = [];
  readonly #events: LoggedEvent[] = [];
  readonly #latency: DebugLatencyPayload[] = [];
  readonly #usage: Partial<Record<Lane, Omit<LaneUsage, 'costUsd'>>> = {};
  #words: SttWord[] = [];

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /** She picked up: every time in the log counts from here. */
  connected(): void {
    this.#connectedAt ??= this.#now();
  }

  get isConnected(): boolean {
    return this.#connectedAt !== null;
  }

  /** Milliseconds since she picked up, for a wall-clock time (0 before she did). */
  #since(epochMs: number): number {
    return this.#connectedAt === null ? 0 : Math.max(0, Math.round(epochMs - this.#connectedAt));
  }

  #span(timing: TurnTiming, fallbackMs: number): { startMs: number; endMs: number } {
    const end =
      timing.stoppedSpeakingAt !== undefined ? toMs(timing.stoppedSpeakingAt) : timing.committedAt;
    const start =
      timing.startedSpeakingAt !== undefined ? toMs(timing.startedSpeakingAt) : end - fallbackMs;
    const startMs = this.#since(start);
    return { startMs, endMs: Math.max(startMs, this.#since(end)) };
  }

  /** A final STT result; its words belong to the next committed rep turn. */
  sttFinal(words: readonly SttWord[]): void {
    this.#words.push(...words);
  }

  repTurn(input: { text: string; timing: TurnTiming; repTurn: number }): number {
    const words = this.#words.filter((w) => w.startTime !== undefined && w.endTime !== undefined);
    this.#words = [];
    // Without metrics, assume 150 words a minute.
    const estimate = (input.text.split(/\s+/).length / 2.5) * 1000;
    const { startMs, endMs } = this.#span(input.timing, estimate);
    return this.#push({
      speaker: 'rep',
      text: input.text,
      startMs,
      endMs,
      words: words.length ? this.#anchor(words, startMs) : null,
      interrupted: false,
      repTurn: input.repTurn,
      stateAfter: null,
    });
  }

  /**
   * Deepgram's word times run on the STT stream's clock, which LiveKit doesn't
   * expose. Pinning the first word to the turn's start (LiveKit's VAD time)
   * keeps every gap inside the turn exact.
   */
  #anchor(words: SttWord[], startMs: number): TimedWord[] {
    const origin = words[0]?.startTime ?? 0;
    return words.map((w) => {
      const wordStart = startMs + toMs((w.startTime ?? origin) - origin);
      return {
        text: w.text,
        startMs: wordStart,
        endMs: Math.max(wordStart, startMs + toMs((w.endTime ?? origin) - origin)),
      };
    });
  }

  prospectTurn(input: {
    text: string;
    timing: TurnTiming;
    interrupted: boolean;
    state: ProspectState | null;
  }): number {
    const estimate = (input.text.split(/\s+/).length / 2.7) * 1000;
    const { startMs, endMs } = this.#span(input.timing, estimate);
    return this.#push({
      speaker: 'prospect',
      text: input.text,
      startMs,
      endMs,
      words: null,
      interrupted: input.interrupted,
      stateAfter: input.state,
    });
  }

  #push(turn: Omit<RecordedTurn, 'idx'>): number {
    const idx = this.#turns.length;
    this.#turns.push({ ...turn, idx });
    return idx;
  }

  /** The committed turns so far, for the live coach's metrics. */
  metricTurns(): MetricTurn[] {
    return this.#turns.map(({ speaker, text, startMs, endMs, words, interrupted }) => ({
      speaker,
      text,
      startMs,
      endMs,
      words,
      interrupted,
    }));
  }

  /**
   * Rewind: drops the rep's last turn and everything after it (her reply to
   * it), so the log keeps the call as it stands, and returns what was taken
   * back for the `rewind` event. Null if the rep has no turn to take back.
   */
  rewind(): RewindEventPayload | null {
    this.#words = [];
    const last = this.#turns.findLastIndex((t) => t.speaker === 'rep');
    const taken = this.#turns[last];
    if (!taken) return null;
    const reply = this.#turns.slice(last + 1).find((t) => t.speaker === 'prospect');
    this.#turns.length = last;
    return { beforeTurn: last + 1, tookBack: taken.text, herReply: reply?.text ?? null };
  }

  event(kind: EventKind, payload: Record<string, unknown>): void {
    this.#events.push({ tMs: this.#since(this.#now()), kind, payload });
  }

  latency(payload: DebugLatencyPayload): void {
    this.#latency.push(payload);
  }

  usage(lane: Lane, model: string, usage: TokenUsage): void {
    const lane_ = (this.#usage[lane] ??= {
      model,
      calls: 0,
      inputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 0,
    });
    lane_.model = model;
    lane_.calls += 1;
    lane_.inputTokens += usage.inputTokens;
    lane_.cacheReadInputTokens += usage.cacheReadInputTokens;
    lane_.cacheCreationInputTokens += usage.cacheCreationInputTokens;
    lane_.outputTokens += usage.outputTokens;
  }

  build(end: {
    outcome: CallOutcome;
    reason?: string;
    /** When the call ended (epoch ms); now if not given. */
    at?: number;
    /** The judged state after each rep turn, by the brain's turn number. */
    stateAfterRepTurn: (repTurn: number) => ProspectState | null;
  }): CallLog {
    const endedAt = end.at ?? this.#now();
    const usage: CallLog['usage'] = {};
    for (const lane of LANES) {
      const u = this.#usage[lane];
      if (u) usage[lane] = { ...u, costUsd: costUsd(u.model, u) };
    }
    return {
      outcome: end.outcome,
      ...(end.reason ? { reason: end.reason } : {}),
      connectedAt: this.#connectedAt === null ? null : new Date(this.#connectedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      durationMs: this.#since(endedAt),
      turns: this.#turns.map(({ repTurn, ...turn }) => ({
        ...turn,
        stateAfter: repTurn === undefined ? turn.stateAfter : end.stateAfterRepTurn(repTurn),
      })),
      events: this.#events,
      latency: this.#latency,
      usage,
    };
  }
}
