// Whether LiveKit accepts the API's key pair. A wrong pair otherwise shows only
// when someone dials, as LiveKit refusing the rep's token (and the agent's
// registration) with a 401; this lets the health check, and so the page's
// header, say so before anyone dials. Verdicts are cached, so the health check
// stays cheap, and a slow LiveKit never holds it up.
import { RoomServiceClient, TwirpError } from 'livekit-server-sdk';
import type { LiveKitConfig } from './config.ts';

export type LiveKitAuth = 'ok' | 'rejected' | 'unknown';

export interface LiveKitAuthCheck {
  /** The latest verdict: 'unknown' until LiveKit has answered, or while it can't be reached. */
  auth(): Promise<LiveKitAuth>;
}

export const LIVEKIT_REJECTED =
  'Calls are off: LiveKit rejected LIVEKIT_API_KEY and LIVEKIT_API_SECRET on the API. ' +
  'They must be a key and its secret from the project in LIVEKIT_URL.';

/** How long a verdict stands; a key pair only changes with a redeploy, so this is generous. */
export const VERDICT_MS = 60_000;
/** How soon to ask again after LiveKit couldn't be reached. */
export const RETRY_MS = 10_000;
/** The longest a health check waits for LiveKit before answering without it. */
export const WAIT_MS = 2_000;

/** LiveKit refused the credentials, as opposed to not answering at all. */
export const isRejection = (error: unknown) =>
  error instanceof TwirpError && (error.status === 401 || error.status === 403);

/** Lists rooms, which LiveKit only allows with a valid key pair. */
export function roomServiceProbe(livekit: LiveKitConfig): () => Promise<void> {
  const client = new RoomServiceClient(livekit.url, livekit.apiKey, livekit.apiSecret, {
    requestTimeout: 5,
    failover: false,
  });
  return async () => {
    await client.listRooms();
  };
}

export class LiveKitCheck implements LiveKitAuthCheck {
  readonly #probe: () => Promise<void>;
  readonly #now: () => number;
  readonly #onRejected: () => void;
  #last: { at: number; auth: LiveKitAuth } | null = null;
  #running: Promise<LiveKitAuth> | null = null;

  constructor(
    probe: () => Promise<void>,
    options: { now?: () => number; onRejected?: () => void } = {},
  ) {
    this.#probe = probe;
    this.#now = options.now ?? Date.now;
    this.#onRejected = options.onRejected ?? (() => {});
  }

  auth(): Promise<LiveKitAuth> {
    const last = this.#last;
    if (last && this.#now() - last.at < (last.auth === 'unknown' ? RETRY_MS : VERDICT_MS)) {
      return Promise.resolve(last.auth);
    }
    this.#running ??= this.#ask();
    return within(this.#running, WAIT_MS, last?.auth ?? 'unknown');
  }

  async #ask(): Promise<LiveKitAuth> {
    let auth: LiveKitAuth;
    try {
      await this.#probe();
      auth = 'ok';
    } catch (error) {
      auth = isRejection(error) ? 'rejected' : 'unknown';
    }
    if (auth === 'rejected' && this.#last?.auth !== 'rejected') this.#onRejected();
    this.#last = { at: this.#now(), auth };
    this.#running = null;
    return auth;
  }
}

/** The promise's value, or `fallback` if it takes longer than `ms`. */
function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}
