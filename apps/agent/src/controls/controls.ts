// The rep's controls (PLAN.md §8.3), called over RPC from the web: pause and
// resume, a hint, rewind, hang up. Coached calls only, apart from hanging up.
// Each is logged as an event so the review can mention it.
import type {
  CallMode,
  CallOutcome,
  CallPhase,
  EventKind,
  HintResponse,
  RewindEventPayload,
  RpcOk,
} from '@ccc/contracts';
import type { MetricTurn } from '@ccc/core';
import type { llm } from '@livekit/agents';
import { HintError, type HintSource, describeHintError } from '../coach/hint.ts';

/** A refusal or failure the rep sees as it is (the RPC error's message). */
export class ControlError extends Error {}

/** How long a rewind waits for her interrupted reply to settle into the conversation. */
export const REWIND_SETTLE_MS = 2_000;

export interface ControlLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface CallControlsDeps {
  mode: CallMode;
  session: {
    input: { setAudioEnabled(enabled: boolean): void };
    /** LiveKit's Future: `.await` settles once the interruption has been processed. */
    interrupt(): { readonly await: Promise<void> };
    clearUserTurn(): void;
    say(text: string, options: { addToChatCtx: boolean }): unknown;
  };
  agent: {
    readonly chatCtx: llm.ChatContext;
    updateChatCtx(chatCtx: llm.ChatContext): Promise<void>;
  };
  brain: {
    readonly repTurns: number;
    readonly meeting: string | null;
    rewindTo(turn: number): void;
  };
  recorder: {
    event(kind: EventKind, payload: Record<string, unknown>): void;
    rewind(): RewindEventPayload | null;
    metricTurns(): MetricTurn[];
  };
  coach: {
    paused(at: number): void;
    resumed(): void;
    rewound(turn: number): void;
    turnsChanged(turns: readonly MetricTurn[]): void;
  };
  controller: {
    readonly phase: CallPhase;
    end(outcome: CallOutcome, reason?: string): Promise<void>;
  };
  hints: HintSource;
  /** The hint prompt for the conversation as it stands. */
  hintPrompt: () => { system: string; user: string };
  /** The rep turn count behind `debug.latency` labels. */
  latency?: { rewound(): void };
  logger: ControlLogger;
  now?: () => number;
}

const isMessage = (item: llm.ChatItem): item is llm.ChatMessage => item.type === 'message';

function lastRepMessage(items: readonly llm.ChatItem[]): number {
  return items.findLastIndex((item) => isMessage(item) && item.role === 'user');
}

/** Her last line before `index`, as the rep heard it. */
function herLineBefore(items: readonly llm.ChatItem[], index: number): string | null {
  for (let i = index - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item && isMessage(item) && item.role === 'assistant' && item.textContent?.trim()) {
      return item.textContent.trim();
    }
  }
  return null;
}

export class CallControls {
  readonly #deps: CallControlsDeps;
  readonly #now: () => number;
  #pausedAt: number | null = null;
  #rewinding = false;
  #hint: Promise<HintResponse> | null = null;

  constructor(deps: CallControlsDeps) {
    this.#deps = deps;
    this.#now = deps.now ?? Date.now;
  }

  /** The agent ignores turns while this is true (ProspectAgent.onUserTurnCompleted). */
  get paused(): boolean {
    return this.#pausedAt !== null;
  }

  /** Why a coached-only control can't run now, or null if it can. */
  #refusal(what: string): string | null {
    if (this.#deps.mode !== 'coached') return `${what} is off in exam mode.`;
    switch (this.#deps.controller.phase) {
      case 'ringing':
        return "She hasn't picked up yet.";
      case 'ended':
        return 'The call is over.';
      case 'connected':
        return null;
    }
  }

  pause(): RpcOk {
    const refusal = this.#refusal('Pause');
    if (refusal) return { ok: false, reason: refusal };
    if (this.#pausedAt !== null) return { ok: true };
    const { session, coach, recorder, logger } = this.#deps;
    this.#pausedAt = this.#now();
    session.input.setAudioEnabled(false);
    session.clearUserTurn();
    void this.#interrupt(); // she stops now; nothing needs to wait for LiveKit to finish
    coach.paused(this.#pausedAt);
    recorder.event('pause', {});
    logger.info({}, 'paused');
    return { ok: true };
  }

  resume(): RpcOk {
    if (this.#pausedAt !== null) this.#resume();
    return { ok: true };
  }

  #resume(): void {
    const { session, coach, recorder, logger } = this.#deps;
    const pausedMs = Math.max(0, this.#now() - (this.#pausedAt ?? this.#now()));
    this.#pausedAt = null;
    session.input.setAudioEnabled(true);
    coach.resumed();
    recorder.event('resume', { pausedMs });
    logger.info({ pausedMs }, 'resumed');
  }

  /** Get help: what to say next, and why. A second press while one is on its way shares it. */
  hint(): Promise<HintResponse> {
    const refusal = this.#refusal('Help');
    if (refusal) return Promise.reject(new ControlError(refusal));
    if (!this.#hint) {
      this.#hint = this.#fetchHint().finally(() => {
        this.#hint = null;
      });
    }
    return this.#hint;
  }

  async #fetchHint(): Promise<HintResponse> {
    const { hints, hintPrompt, recorder, logger } = this.#deps;
    try {
      const { ms, ...help } = await hints(hintPrompt());
      recorder.event('hint', { ...help, ms });
      return help;
    } catch (error) {
      logger.warn({ err: error }, 'hint failed');
      throw new ControlError(error instanceof HintError ? error.message : describeHintError(error));
    }
  }

  /**
   * Rewind (PLAN.md §8.3): stop her, truncate her conversation to just before
   * the rep's last turn (earlier turns are never edited), restore her state
   * from before it, and have her say her previous line again without adding it
   * to the conversation a second time. Rewinding a paused call resumes it.
   */
  async rewind(): Promise<RpcOk> {
    const refusal = this.#refusal('Rewind');
    if (refusal) return { ok: false, reason: refusal };
    const { session, agent, brain, recorder, coach, latency, logger } = this.#deps;
    if (brain.meeting !== null) {
      return { ok: false, reason: 'The meeting is booked, so there is nothing to take back.' };
    }
    if (this.#rewinding) return { ok: false, reason: 'Already rewinding.' };
    if (lastRepMessage(agent.chatCtx.items) === -1 || brain.repTurns === 0) {
      return { ok: false, reason: "There's no turn of yours to take back yet." };
    }

    this.#rewinding = true;
    try {
      // Her reply is committed (cut off) as she stops; wait for that before cutting.
      await Promise.race([this.#interrupt(), sleep(REWIND_SETTLE_MS)]);
      session.clearUserTurn();
      const items = agent.chatCtx.items;
      const cut = lastRepMessage(items);
      if (cut === -1) return { ok: false, reason: "There's no turn of yours to take back yet." };
      const herLine = herLineBefore(items, cut);
      const truncated = agent.chatCtx.copy();
      truncated.items = truncated.items.slice(0, cut);
      await agent.updateChatCtx(truncated);

      const turn = brain.repTurns;
      brain.rewindTo(turn);
      const taken = recorder.rewind();
      latency?.rewound();
      coach.rewound(turn);
      coach.turnsChanged(recorder.metricTurns());
      recorder.event('rewind', { ...taken, repTurn: turn });
      logger.info({ turn, tookBack: taken?.tookBack }, 'rewound the rep’s last turn');

      if (this.#pausedAt !== null) this.#resume();
      if (herLine) session.say(herLine, { addToChatCtx: false });
      return { ok: true };
    } finally {
      this.#rewinding = false;
    }
  }

  hangup(): RpcOk {
    if (this.#deps.controller.phase === 'ended') return { ok: true };
    void this.#deps.controller.end('ended_by_rep');
    return { ok: true };
  }

  /** Stops her mid-speech; resolves once LiveKit has processed it. */
  #interrupt(): Promise<void> {
    try {
      return this.#deps.session.interrupt().await;
    } catch (error) {
      // Only a speech that disallows interruptions refuses; none of hers does.
      this.#deps.logger.warn({ err: error }, 'could not interrupt her');
      return Promise.resolve();
    }
  }
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
