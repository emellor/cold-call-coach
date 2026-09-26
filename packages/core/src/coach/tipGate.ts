// Which of the judge's tips reach the rep (PLAN.md §8.2): coached calls only,
// severity warn only, at most one every 20 s, and never while she is talking
// over the rep. A tip that arrives mid-overlap waits for it to end, briefly.
import type { CallMode, CoachTipPayload, JudgeResult } from '@ccc/contracts';

/** At most one tip in this long. */
export const TIP_MIN_GAP_MS = 20_000;
/** A tip held back during overlapping speech is dropped once it is this old. */
export const TIP_MAX_HOLD_MS = 5_000;

type JudgeTip = NonNullable<JudgeResult['tip']>;

interface HeldTip {
  tip: JudgeTip;
  turn: number;
  at: number;
}

/** Times are milliseconds on any one clock, passed in by the caller. */
export class TipGate {
  readonly #mode: CallMode;
  #lastShownAt: number | null = null;
  #held: HeldTip | null = null;
  #shown = 0;

  constructor(mode: CallMode) {
    this.#mode = mode;
  }

  /**
   * The judge's tip for rep turn `turn`. Returns the payload to publish now,
   * or null: filtered out, too soon after the last one, or held because both
   * are speaking (see `release`).
   */
  offer(
    tip: JudgeTip | null,
    turn: number,
    at: number,
    overlapping: boolean,
  ): CoachTipPayload | null {
    if (this.#mode !== 'coached' || tip?.severity !== 'warn' || this.#tooSoon(at)) return null;
    if (overlapping) {
      this.#held = { tip, turn, at };
      return null;
    }
    this.#held = null;
    return this.#show(tip, turn, at);
  }

  /** The overlap is over: a held tip goes out if it is still fresh. */
  release(at: number): CoachTipPayload | null {
    const held = this.#held;
    this.#held = null;
    if (!held || at - held.at > TIP_MAX_HOLD_MS || this.#tooSoon(at)) return null;
    return this.#show(held.tip, held.turn, at);
  }

  /** A rewind took back rep turns from `turn` on: a tip about them no longer applies. */
  discardFrom(turn: number): void {
    if (this.#held && this.#held.turn >= turn) this.#held = null;
  }

  #tooSoon(at: number): boolean {
    return this.#lastShownAt !== null && at - this.#lastShownAt < TIP_MIN_GAP_MS;
  }

  #show(tip: JudgeTip, turn: number, at: number): CoachTipPayload {
    this.#lastShownAt = at;
    this.#shown += 1;
    return { id: `tip-${this.#shown}`, turn, severity: tip.severity, text: tip.text };
  }
}
