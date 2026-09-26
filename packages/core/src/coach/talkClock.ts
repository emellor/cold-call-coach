// The live talk clock (PLAN.md §8.1, live): who has spoken for how long, and
// the rep's monologue under way, from the speaking-state changes LiveKit
// reports during the call. The post-call metrics come from the committed turns
// instead; this is the running figure the coach panel shows meanwhile. Its
// monologue rule is computeMetrics' rule: rep speech separated by gaps under
// 1.5 s is one monologue, unless she spoke in the gap.
import { MONOLOGUE_GAP_MS } from '../metrics/metrics.ts';

export interface TalkSnapshot {
  repSpeechMs: number;
  prospectSpeechMs: number;
  /** The monologue under way: 0 once the rep has stopped for 1.5 s or she has spoken since. */
  currentMonologueMs: number;
  longestMonologueMs: number;
  repSpeaking: boolean;
  prospectSpeaking: boolean;
}

interface Monologue {
  start: number;
  /** When the rep last stopped; null while they are speaking. */
  lastEnd: number | null;
}

/** Times are milliseconds on any one clock; the caller passes them in, so this stays pure. */
export class TalkClock {
  #repSince: number | null = null;
  #prospectSince: number | null = null;
  #prospectLastStop: number | null = null;
  #repMs = 0;
  #prospectMs = 0;
  #monologue: Monologue | null = null;
  #longestMs = 0;

  repStarted(at: number): void {
    if (this.#repSince !== null) return;
    this.#repSince = at;
    const m = this.#monologue;
    if (
      m?.lastEnd != null &&
      at - m.lastEnd < MONOLOGUE_GAP_MS &&
      !this.#herVoiceSince(m.lastEnd)
    ) {
      m.lastEnd = null;
    } else {
      this.#monologue = { start: at, lastEnd: null };
    }
  }

  repStopped(at: number): void {
    const since = this.#repSince;
    if (since === null) return;
    const end = Math.max(at, since);
    this.#repMs += end - since;
    this.#repSince = null;
    if (this.#monologue) {
      this.#monologue.lastEnd = end;
      this.#longestMs = Math.max(this.#longestMs, end - this.#monologue.start);
    }
  }

  prospectStarted(at: number): void {
    this.#prospectSince ??= at;
  }

  prospectStopped(at: number): void {
    const since = this.#prospectSince;
    if (since === null) return;
    const end = Math.max(at, since);
    this.#prospectMs += end - since;
    this.#prospectSince = null;
    this.#prospectLastStop = end;
  }

  /** Both are speaking: she is talking over the rep, or the rep over her. */
  get overlapping(): boolean {
    return this.#repSince !== null && this.#prospectSince !== null;
  }

  snapshot(now: number): TalkSnapshot {
    const running = (since: number | null) => (since === null ? 0 : Math.max(0, now - since));
    const current = this.#currentMonologueMs(now);
    return {
      repSpeechMs: this.#repMs + running(this.#repSince),
      prospectSpeechMs: this.#prospectMs + running(this.#prospectSince),
      currentMonologueMs: current,
      longestMonologueMs: Math.max(this.#longestMs, current),
      repSpeaking: this.#repSince !== null,
      prospectSpeaking: this.#prospectSince !== null,
    };
  }

  #currentMonologueMs(now: number): number {
    const m = this.#monologue;
    if (!m) return 0;
    if (m.lastEnd === null) return Math.max(0, now - m.start);
    const open = now - m.lastEnd < MONOLOGUE_GAP_MS && !this.#herVoiceSince(m.lastEnd);
    return open ? m.lastEnd - m.start : 0;
  }

  /** She has spoken at some point after `t` (or is speaking now). */
  #herVoiceSince(t: number): boolean {
    return (
      this.#prospectSince !== null ||
      (this.#prospectLastStop !== null && this.#prospectLastStop > t)
    );
  }
}
