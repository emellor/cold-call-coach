import { type CallOutcome, type CallPhase, MAX_CALL_SECONDS, Topics } from '@ccc/contracts';
import type { Logger } from './logger.ts';
import type { Publisher } from './publisher.ts';

/** How long the phone rings before she picks up (PLAN.md §5, step 3). */
export const RING_MS = { min: 2_000, max: 5_000 } as const;

export const ringDelayMs = (random: () => number): number =>
  RING_MS.min + Math.floor(random() * (RING_MS.max - RING_MS.min + 1));

export interface CallControllerDeps {
  session: {
    input: { setAudioEnabled(enabled: boolean): void };
    say(text: string): unknown;
  };
  publisher: Pick<Publisher, 'publish'>;
  /** Ends the LiveKit job; called once, after the final `call.state`. */
  shutdown(reason: string): void;
  logger: Logger;
  /** Her first words as she picks up; null in a reverse call, where the rep answers. */
  openingLine: string | null;
  random?: () => number;
  /** She has just picked up (before `connected` is published). */
  onConnected?: () => void;
  /** The call has just ended (before `ended` is published). */
  onEnded?: (ending: CallEnding) => void;
}

/** How the call ended: the outcome, why, which side ended it, and when (epoch ms). */
export interface CallEnding {
  outcome: CallOutcome;
  reason?: string;
  endedBy: CallOutcome;
  at: number;
}

/**
 * The call's lifecycle: ring, pick up with the scenario's opening line (no LLM,
 * so the pick-up is instant), enforce the 15-minute ceiling, and end exactly
 * once whichever side ends it. A booked meeting is the call's outcome however
 * it then ends. In a reverse call the rep picks up, so nothing is said for them.
 */
export class CallController {
  readonly #deps: CallControllerDeps;
  readonly #stop = new AbortController();
  #phase: CallPhase = 'ringing';
  #ending: Promise<void> | undefined;
  #ended: CallEnding | undefined;
  #meeting: string | undefined;

  constructor(deps: CallControllerDeps) {
    this.#deps = deps;
  }

  get phase(): CallPhase {
    return this.#phase;
  }

  /** Set once the call has ended. */
  get ended(): CallEnding | undefined {
    return this.#ended;
  }

  /** She agreed to a meeting and the rules let it stand; the call carries on. */
  async recordMeeting(when: string): Promise<void> {
    if (this.#meeting !== undefined || this.#phase !== 'connected') return;
    this.#meeting = when;
    this.#deps.logger.info({ when }, 'meeting booked');
    await this.#deps.publisher.publish(Topics.callState, {
      phase: 'connected',
      outcome: 'meeting_booked',
      reason: when,
    });
  }

  async ringAndPickUp(): Promise<void> {
    const { session, publisher, openingLine, random = Math.random } = this.#deps;
    // Nothing the rep says reaches her until she has answered.
    session.input.setAudioEnabled(false);
    await publisher.publish(Topics.callState, { phase: 'ringing' });

    await this.#sleep(ringDelayMs(random));
    if (this.#phase !== 'ringing') return;

    this.#phase = 'connected';
    this.#deps.onConnected?.();
    session.input.setAudioEnabled(true);
    await publisher.publish(Topics.callState, { phase: 'connected' });
    if (openingLine !== null) session.say(openingLine);

    void this.#sleep(MAX_CALL_SECONDS * 1000).then(() => {
      if (this.#phase === 'connected')
        void this.end('timeout', 'The 15-minute call limit was reached.');
    });
  }

  /** Idempotent: the first caller's outcome wins. */
  end(outcome: CallOutcome, reason?: string): Promise<void> {
    this.#ending ??= this.#finish(outcome, reason);
    return this.#ending;
  }

  async #finish(endedBy: CallOutcome, why: string | undefined): Promise<void> {
    this.#phase = 'ended';
    this.#stop.abort();
    const outcome = this.#meeting === undefined ? endedBy : 'meeting_booked';
    const reason = this.#meeting ?? why;
    this.#ended = { outcome, ...(reason ? { reason } : {}), endedBy, at: Date.now() };
    this.#deps.onEnded?.(this.#ended);
    await this.#deps.publisher.publish(Topics.callState, {
      phase: 'ended',
      outcome,
      ...(reason ? { reason } : {}),
    });
    this.#deps.logger.info({ outcome, reason, endedBy, why }, 'call ended');
    this.#deps.shutdown(outcome);
  }

  /** Resolves after `ms`, or as soon as the call ends. */
  #sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (this.#stop.signal.aborted) return resolve();
      const timer = setTimeout(resolve, ms);
      this.#stop.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
}
