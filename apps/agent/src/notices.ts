// The agent's call.notice feed (M6): provider failures mid-call and the cost
// warning. A notice repeats only when its words change, so a failing provider
// doesn't flood the page or the call log.
import type { CallNoticePayload } from '@ccc/contracts';

export class CallNotices {
  readonly #send: (notice: CallNoticePayload) => void;
  readonly #last = new Map<CallNoticePayload['code'], string>();

  /** `send` publishes the notice and keeps it in the call log. */
  constructor(send: (notice: CallNoticePayload) => void) {
    this.#send = send;
  }

  /** Sends the notice unless the last one with its code said the same. */
  notify(notice: CallNoticePayload): boolean {
    if (this.#last.get(notice.code) === notice.message) return false;
    this.#last.set(notice.code, notice.message);
    this.#send(notice);
    return true;
  }
}

/** Fires once, the first time what the call has cost passes the warning line. */
export class CostWatch {
  readonly #warnAboveUsd: number | null;
  readonly #costSoFar: () => number;
  readonly #onOver: (spentUsd: number, warnAboveUsd: number) => void;
  #fired = false;

  constructor(options: {
    /** Null without a price table: nothing is priced, so nothing to watch. */
    warnAboveUsd: number | null;
    costSoFar: () => number;
    onOver: (spentUsd: number, warnAboveUsd: number) => void;
  }) {
    this.#warnAboveUsd = options.warnAboveUsd;
    this.#costSoFar = options.costSoFar;
    this.#onOver = options.onOver;
  }

  check(): void {
    if (this.#fired || this.#warnAboveUsd === null) return;
    const spent = this.#costSoFar();
    if (spent <= this.#warnAboveUsd) return;
    this.#fired = true;
    this.#onOver(spent, this.#warnAboveUsd);
  }
}
