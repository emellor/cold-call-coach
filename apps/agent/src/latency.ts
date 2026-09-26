import type { DebugLatencyPayload } from '@ccc/contracts';
import type { llm } from '@livekit/agents';

const ms = (seconds: number | undefined): number | null =>
  seconds === undefined ? null : Math.max(0, Math.round(seconds * 1000));

/**
 * Builds one `debug.latency` payload per prospect reply from LiveKit's message
 * metrics. End-of-turn delay lives on the rep's message; the LLM, TTS and
 * end-to-end figures on the prospect's.
 */
export class LatencyTracker {
  #repTurns = 0;
  #lastRepMetrics: llm.MetricsReport | undefined;

  /** Feed every `conversation_item_added` item; returns a payload for prospect replies. */
  onItem(item: {
    type: string;
    role?: string;
    metrics?: llm.MetricsReport;
  }): DebugLatencyPayload | null {
    if (item.type !== 'message') return null;
    if (item.role === 'user') {
      this.#repTurns += 1;
      this.#lastRepMetrics = item.metrics;
      return null;
    }
    if (item.role !== 'assistant') return null;

    const reply = item.metrics ?? {};
    const payload: DebugLatencyPayload = {
      turn: this.#repTurns,
      endOfTurnMs: ms(this.#lastRepMetrics?.endOfTurnDelay),
      llmTtftMs: ms(reply.llmNodeTtft),
      ttsTtfbMs: ms(reply.ttsNodeTtfb),
      e2eMs: ms(reply.e2eLatency),
    };
    this.#lastRepMetrics = undefined;
    return payload;
  }

  /** A rewind took back the rep's last turn: the retake keeps its number. */
  rewound(): void {
    this.#repTurns = Math.max(0, this.#repTurns - 1);
  }
}
