import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { describe, expect, it, vi } from 'vitest';
import { PROSPECT_TOOLS, actionsFromMessage, closingLine } from './tools.ts';

const message = (
  stop_reason: BetaMessage['stop_reason'],
  content: Array<{ type: string; [key: string]: unknown }>,
) => ({ stop_reason, content }) as unknown as BetaMessage;
const toolUse = (name: string, input: unknown) => ({
  type: 'tool_use',
  id: `t-${name}`,
  name,
  input,
});
const text = (t: string) => ({ type: 'text', text: t });

describe('PROSPECT_TOOLS', () => {
  it('offers end_call and agree_to_meeting, streamed eagerly', () => {
    expect(PROSPECT_TOOLS.map((t) => ('name' in t ? t.name : ''))).toEqual([
      'end_call',
      'agree_to_meeting',
    ]);
    for (const tool of PROSPECT_TOOLS) expect(tool).toMatchObject({ eager_input_streaming: true });
  });
});

describe('actionsFromMessage', () => {
  it('reads both tools from a finished reply, in order', () => {
    const actions = actionsFromMessage(
      message('tool_use', [
        text('Fine, Tuesday at ten. Bye.'),
        toolUse('agree_to_meeting', { when: 'Tuesday at 10am' }),
        toolUse('end_call', { reason: 'Meeting booked' }),
      ]),
    );
    expect(actions).toEqual([
      { type: 'agree_to_meeting', when: 'Tuesday at 10am' },
      { type: 'end_call', reason: 'Meeting booked' },
    ]);
  });

  it('returns nothing for a plain spoken reply', () => {
    expect(actionsFromMessage(message('end_turn', [text('Go on.')]))).toEqual([]);
  });

  it('drops a tool call whose input fails its schema, and an unknown tool', () => {
    const warn = vi.fn();
    const actions = actionsFromMessage(
      message('tool_use', [
        toolUse('agree_to_meeting', { when: '  ' }),
        toolUse('end_call', {}),
        toolUse('transfer_call', { to: 'MD' }),
      ]),
      { warn },
    );
    expect(actions).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it.each(['max_tokens', 'refusal'] as const)(
    'runs no tools from a reply cut short by %s',
    (stopReason) => {
      const warn = vi.fn();
      const actions = actionsFromMessage(
        message(stopReason, [toolUse('end_call', { reason: 'Busy' })]),
        { warn },
      );
      expect(actions).toEqual([]);
      expect(warn).toHaveBeenCalledWith(
        { tools: ['end_call'], stopReason },
        'reply was cut short; ignoring its tools',
      );
    },
  );
});

describe('closingLine', () => {
  it('covers a meeting, a hang-up, both, and neither', () => {
    expect(closingLine([{ type: 'agree_to_meeting', when: 'Friday at 9' }])).toBe(
      'Fine, Friday at 9 then.',
    );
    expect(closingLine([{ type: 'end_call', reason: 'x' }])).toBe('Right. Goodbye.');
    expect(
      closingLine([
        { type: 'agree_to_meeting', when: 'Friday at 9' },
        { type: 'end_call', reason: 'x' },
      ]),
    ).toBe('Fine, Friday at 9 then. Bye.');
    expect(closingLine([])).toBeUndefined();
  });
});
