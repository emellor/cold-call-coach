// Where the per-turn state note goes (PLAN.md §6.5). Opus 5 takes it as a
// final mid-conversation system message, which leaves the cached prefix
// untouched. Models without that (Haiku 4.5) get it appended to the caller's
// last turn, fenced off so it can't be mistaken for something he said.
import type { ModelCapabilities } from '../claude/models.ts';
import type { ChatTurn } from './messages.ts';

export function withStateNote(
  messages: readonly ChatTurn[],
  note: string,
  caps: Pick<ModelCapabilities, 'midConversationSystem'>,
): ChatTurn[] {
  const last = messages.at(-1);
  if (last?.role !== 'user') {
    // buildProspectMessages always ends on the caller; a system message must follow one.
    throw new Error('the state note must follow a user turn');
  }
  if (caps.midConversationSystem) return [...messages, { role: 'system', content: note }];
  return [
    ...messages.slice(0, -1),
    { role: 'user', content: `${last.content}\n\n<private_note>\n${note}\n</private_note>` },
  ];
}
