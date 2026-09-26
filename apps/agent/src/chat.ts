import type { TranscriptTurn } from '@ccc/core';
import type { llm } from '@livekit/agents';

/**
 * The spoken turns in LiveKit's chat context, in order. System items (the
 * framework copies the agent's instructions in) and tool items are skipped:
 * the persona travels in Claude's `system` field instead.
 */
export function chatContextToTurns(chatCtx: llm.ChatContext): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const item of chatCtx.items) {
    if (item.type !== 'message') continue;
    if (item.role !== 'user' && item.role !== 'assistant') continue;
    const text = item.textContent;
    if (!text) continue;
    turns.push({
      speaker: item.role === 'user' ? 'rep' : 'prospect',
      text,
      interrupted: item.interrupted,
    });
  }
  return turns;
}

/** How long the rep spoke in a committed turn, from LiveKit's message metrics (0 if unknown). */
export function repSpeakingSeconds(metrics: llm.MetricsReport | undefined): number {
  const { startedSpeakingAt, stoppedSpeakingAt } = metrics ?? {};
  if (startedSpeakingAt === undefined || stoppedSpeakingAt === undefined) return 0;
  return Math.max(0, stoppedSpeakingAt - startedSpeakingAt);
}
