// Links each generated reply to what it asked for (tool calls, a forced
// goodbye) so that nothing acts until that reply has been heard. LiveKit may
// generate a reply early and discard it (preemptive generation), or the rep
// may cut her off: only a reply committed whole to the conversation counts.
// Sam's replies in a reverse call go through the same ledger with his tools.
import { randomUUID } from 'node:crypto';
import type { ProspectAction } from './tools.ts';

/** Where the reply id rides on LiveKit's committed ChatMessage (`extra`). */
export const REPLY_ID_KEY = 'cccReplyId';

export interface Reply<A = ProspectAction> {
  id: string;
  /** Written under the "you've had enough" note: the call ends after it even without end_call. */
  forcedGoodbye: boolean;
  /** The tool calls in the finished message; empty until it finishes. */
  actions: A[];
}

/** Replies not yet committed are dropped beyond this many; discarded ones never commit. */
const MAX_OPEN = 32;

export class ReplyLedger<A = ProspectAction> {
  readonly #open = new Map<string, Reply<A>>();

  start(forcedGoodbye: boolean): Reply<A> {
    const reply: Reply<A> = { id: randomUUID(), forcedGoodbye, actions: [] };
    this.#open.set(reply.id, reply);
    if (this.#open.size > MAX_OPEN) {
      const oldest = this.#open.keys().next().value;
      if (oldest !== undefined) this.#open.delete(oldest);
    }
    return reply;
  }

  /**
   * The reply behind a committed message, taken off the ledger along with
   * every older one (they were discarded or superseded).
   */
  committed(id: unknown): Reply<A> | undefined {
    if (typeof id !== 'string') return undefined;
    const reply = this.#open.get(id);
    if (!reply) return undefined;
    for (const key of this.#open.keys()) {
      this.#open.delete(key);
      if (key === id) break;
    }
    return reply;
  }
}
