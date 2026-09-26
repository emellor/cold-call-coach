import { llm } from '@livekit/agents';
import { describe, expect, it } from 'vitest';
import { chatContextToTurns } from './chat.ts';

describe('chatContextToTurns', () => {
  it('maps spoken user and assistant messages to rep and prospect turns, in order', () => {
    const ctx = llm.ChatContext.empty();
    ctx.addMessage({ role: 'system', content: 'You are Claire Hughes.' });
    ctx.addMessage({ role: 'assistant', content: 'Claire Hughes.' });
    ctx.addMessage({ role: 'user', content: 'Hi Claire, Sam from WattGuard.' });
    ctx.addMessage({ role: 'assistant', content: "Look, I'm about to", interrupted: true });
    ctx.insert(llm.FunctionCall.create({ callId: 'c1', name: 'end_call', args: '{}' }));
    ctx.addMessage({ role: 'user', content: '' });

    expect(chatContextToTurns(ctx)).toEqual([
      { speaker: 'prospect', text: 'Claire Hughes.', interrupted: false },
      { speaker: 'rep', text: 'Hi Claire, Sam from WattGuard.', interrupted: false },
      { speaker: 'prospect', text: "Look, I'm about to", interrupted: true },
    ]);
  });
});
