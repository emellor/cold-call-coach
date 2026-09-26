// Turns the conversation so far into the message list the prospect's Claude
// call sees. Rebuilt from scratch every turn, text only: no tool_use or
// tool_result blocks ever enter the history (PLAN.md §6.4).

export type Speaker = 'rep' | 'prospect';

export interface TranscriptTurn {
  speaker: Speaker;
  text: string;
  /**
   * The prospect was cut off mid-reply. LiveKit has already truncated `text` to
   * what was actually heard.
   */
  interrupted?: boolean;
}

/** Structurally compatible with the Anthropic SDK's `MessageParam`. */
export interface ChatTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** The Messages API needs a user turn first; the call starts with her picking up. */
export const PICKUP_CUE = '(Your phone rings and you answer.)';
/** Opus 5 rejects a trailing assistant turn (prefill); this stands in for the caller. */
export const SILENCE_CUE = '(The caller says nothing.)';
/** Marks a reply the caller talked over, so she knows she was cut off. */
export const CUT_OFF_MARK = '—';

const ENDS_A_SENTENCE = /[.!?…]["')\]]?$/;

export function buildProspectMessages(turns: readonly TranscriptTurn[]): ChatTurn[] {
  const messages: ChatTurn[] = [];

  for (const turn of turns) {
    let text = turn.text.trim();
    if (!text) continue;
    const role = turn.speaker === 'rep' ? 'user' : 'assistant';
    if (role === 'assistant' && turn.interrupted && !ENDS_A_SENTENCE.test(text)) {
      text += CUT_OFF_MARK;
    }
    const previous = messages.at(-1);
    if (previous?.role === role) {
      // Two turns from one speaker in a row (e.g. a reply cut off before any
      // audio) read as one turn; this keeps user/assistant strictly alternating.
      previous.content = `${previous.content} ${text}`;
    } else {
      messages.push({ role, content: text });
    }
  }

  if (messages[0]?.role !== 'user') messages.unshift({ role: 'user', content: PICKUP_CUE });
  if (messages.at(-1)?.role === 'assistant') messages.push({ role: 'user', content: SILENCE_CUE });
  return messages;
}
