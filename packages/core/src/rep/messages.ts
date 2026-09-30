// Sam's side of a reverse call, as his Claude requests see it: her lines (the
// rep, playing the prospect) are `user`, his are `assistant`. Rebuilt from the
// spoken text every turn, as hers are on a normal call.
import { type ChatTurn, type TranscriptTurn, conversationMessages } from '../prospect/messages.ts';

/** Opens the conversation when Sam spoke first: she picked up and said nothing. */
export const CONNECTED_CUE = '(The call connects, but she says nothing.)';
/** Stands in for her after a line of Sam's she hasn't answered. */
export const HER_SILENCE_CUE = '(She says nothing.)';

export function buildRepMessages(turns: readonly TranscriptTurn[]): ChatTurn[] {
  return conversationMessages(turns, {
    agent: 'rep',
    openingCue: CONNECTED_CUE,
    silenceCue: HER_SILENCE_CUE,
  });
}
