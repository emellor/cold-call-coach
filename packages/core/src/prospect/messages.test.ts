import { describe, expect, it } from 'vitest';
import {
  CUT_OFF_MARK,
  PICKUP_CUE,
  SILENCE_CUE,
  buildProspectMessages,
  type ChatTurn,
} from './messages.ts';

const roles = (messages: ChatTurn[]) => messages.map((m) => m.role);

describe('buildProspectMessages', () => {
  it('prepends the pickup cue when the prospect speaks first', () => {
    const messages = buildProspectMessages([
      { speaker: 'prospect', text: 'Claire Hughes.' },
      { speaker: 'rep', text: 'Hi Claire, it is Sam from WattGuard.' },
    ]);
    expect(messages).toEqual([
      { role: 'user', content: PICKUP_CUE },
      { role: 'assistant', content: 'Claire Hughes.' },
      { role: 'user', content: 'Hi Claire, it is Sam from WattGuard.' },
    ]);
  });

  it('starts with the pickup cue even before anyone has spoken', () => {
    expect(buildProspectMessages([])).toEqual([{ role: 'user', content: PICKUP_CUE }]);
  });

  it('keeps user and assistant strictly alternating by merging same-speaker runs', () => {
    const messages = buildProspectMessages([
      { speaker: 'prospect', text: 'Claire Hughes.' },
      { speaker: 'rep', text: 'Hi Claire.' },
      { speaker: 'rep', text: 'Have you got two minutes?' },
      { speaker: 'prospect', text: 'Right.' },
      { speaker: 'prospect', text: 'What is it about?' },
      { speaker: 'rep', text: 'Energy costs.' },
    ]);
    expect(roles(messages)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(messages[2]?.content).toBe('Hi Claire. Have you got two minutes?');
    expect(messages[3]?.content).toBe('Right. What is it about?');
  });

  it('keeps an interrupted reply truncated to what was heard, marked as cut off', () => {
    const messages = buildProspectMessages([
      { speaker: 'prospect', text: 'Claire Hughes.' },
      { speaker: 'rep', text: 'Hi, quick question about your energy bills.' },
      { speaker: 'prospect', text: "Look, I'm about to go into a", interrupted: true },
      { speaker: 'rep', text: 'It will take thirty seconds.' },
    ]);
    expect(messages[3]).toEqual({
      role: 'assistant',
      content: `Look, I'm about to go into a${CUT_OFF_MARK}`,
    });
  });

  it('does not mark an interrupted reply that had already finished its sentence', () => {
    const messages = buildProspectMessages([
      { speaker: 'rep', text: 'Hello?' },
      { speaker: 'prospect', text: 'Right.', interrupted: true },
      { speaker: 'rep', text: 'Sorry, go on.' },
    ]);
    expect(messages[1]?.content).toBe('Right.');
  });

  it('drops turns that are empty after truncation or trimming', () => {
    const messages = buildProspectMessages([
      { speaker: 'prospect', text: 'Claire Hughes.' },
      { speaker: 'rep', text: 'Hi.' },
      { speaker: 'prospect', text: '', interrupted: true },
      { speaker: 'rep', text: '   ' },
      { speaker: 'rep', text: 'Can you hear me?' },
    ]);
    expect(roles(messages)).toEqual(['user', 'assistant', 'user']);
    expect(messages[2]?.content).toBe('Hi. Can you hear me?');
  });

  it('never ends on an assistant turn, which Opus 5 would reject as a prefill', () => {
    const messages = buildProspectMessages([
      { speaker: 'rep', text: 'Hello?' },
      { speaker: 'prospect', text: 'Claire Hughes.' },
    ]);
    expect(messages.at(-1)).toEqual({ role: 'user', content: SILENCE_CUE });
  });
});
