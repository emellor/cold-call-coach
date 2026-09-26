import { type CallOutcome, type CallPhase, MAX_CALL_SECONDS, Topics } from '@ccc/contracts';
import type { Logger } from './log.ts';
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
  openingLine: string;
  random?: () => number;
}

/**
 * The call's lifecycle: ring, pick up with the scenario's opening line (no LLM,
 * so the pick-up is instant), enforce the 15-minute ceiling, and end exactly
 * once whichever side ends it.
 */
export class CallController {
  readonly #deps: CallControllerDeps;
  readonly #stop = new AbortController();
  #phase: CallPhase = 'ringing';
  #ending: Promise<void> | undefined;

  constructor(deps: CallControllerDeps) {
    this.#deps = deps;
  }

  get phase(): CallPhase {
    return this.#phase;
  }

  async ringAndPickUp(): Promise<void> {
    const { session, publisher, openingLine, random = Math.random } = this.#deps;
    // Nothing the rep says reaches her until she has answered.
    session.input.setAudioEnabled(false);
    await publisher.publish(Topics.callState, { phase: 'ringing' });

    await this.#sleep(ringDelayMs(random));
    if (this.#phase !== 'ringing') return;

    this.#phase = 'connected';
    session.input.setAudioEnabled(true);
    await publisher.publish(Topics.callState, { phase: 'connected' });
    session.say(openingLine);

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

  async #finish(outcome: CallOutcome, reason: string | undefined): Promise<void> {
    this.#phase = 'ended';
    this.#stop.abort();
    await this.#deps.publisher.publish(Topics.callState, {
      phase: 'ended',
      outcome,
      ...(reason ? { reason } : {}),
    });
    this.#deps.logger.info({ outcome, reason }, 'call ended');
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
