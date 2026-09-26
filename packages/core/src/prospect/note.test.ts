import { describe, expect, it } from 'vitest';
import { modelCapabilities } from '../claude/models.ts';
import { buildProspectMessages } from './messages.ts';
import { withStateNote } from './note.ts';
import { clone } from '../test/fixtures.ts';

const NOTE = 'Private note for your next reply (never mention it):\nPatience: some.';
const history = buildProspectMessages([
  { speaker: 'prospect', text: 'Claire Hughes.' },
  { speaker: 'rep', text: "Hi Claire, it's Sam from WattGuard. Got thirty seconds?" },
]);

describe('withStateNote', () => {
  it('adds the note as a final system message for Opus 5', () => {
    const messages = withStateNote(history, NOTE, modelCapabilities('claude-opus-5'));
    expect(messages).toEqual([...history, { role: 'system', content: NOTE }]);
  });

  it('appends the note to the last user turn for Haiku 4.5, with no system message', () => {
    const messages = withStateNote(history, NOTE, modelCapabilities('claude-haiku-4-5'));
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages.at(-1)?.content).toBe(
      `Hi Claire, it's Sam from WattGuard. Got thirty seconds?\n\n<private_note>\n${NOTE}\n</private_note>`,
    );
    expect(messages.slice(0, -1)).toEqual(history.slice(0, -1));
  });

  it('leaves the history it was given untouched, so the cached prefix is stable', () => {
    const before = clone(history);
    withStateNote(history, NOTE, { midConversationSystem: false });
    withStateNote(history, NOTE, { midConversationSystem: true });
    expect(history).toEqual(before);
  });

  it('refuses a history that does not end with the caller', () => {
    expect(() =>
      withStateNote([{ role: 'assistant', content: 'Hello?' }], NOTE, {
        midConversationSystem: true,
      }),
    ).toThrow('must follow a user turn');
  });
});
