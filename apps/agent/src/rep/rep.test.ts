import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { describe, expect, it, vi } from 'vitest';
import { REP_MAX_TOKENS, repRequest } from '../claude/requests.ts';
import { NUDGE_MS, nudgeLine, repVoice } from '../reverseCall.ts';
import { reverseControls } from './controls.ts';
import {
  REP_TOOLS,
  type RepAction,
  actOnRepReply,
  repActionsFromMessage,
  repClosingLine,
} from './tools.ts';

const message = (content: unknown[], stop_reason = 'tool_use') =>
  ({ model: 'claude-opus-5-5', stop_reason, content, usage: {} }) as unknown as BetaMessage;

const tool = (name: string, input: unknown) => ({ type: 'tool_use', id: name, name, input });

describe("Sam's tools", () => {
  it('reads a booked meeting and a hang-up from his finished reply', () => {
    const actions = repActionsFromMessage(
      message([
        { type: 'text', text: 'Tuesday at ten it is. Thanks, Rachel.' },
        tool('book_meeting', { when: 'Tuesday at 10am' }),
        tool('end_call', { reason: 'Meeting booked' }),
      ]),
    );
    expect(actions).toEqual([
      { type: 'book_meeting', when: 'Tuesday at 10am' },
      { type: 'end_call', reason: 'Meeting booked' },
    ]);
  });

  it('runs no tool from a reply cut short, and drops one with a bad input', () => {
    const warn = vi.fn();
    expect(
      repActionsFromMessage(message([tool('book_meeting', { when: 'Tuesday' })], 'max_tokens'), {
        warn,
      }),
    ).toEqual([]);
    expect(repActionsFromMessage(message([tool('book_meeting', { when: ' ' })]), { warn })).toEqual(
      [],
    );
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('says something when a reply was only a tool call', () => {
    expect(repClosingLine([{ type: 'book_meeting', when: 'Tuesday at 10am' }])).toBe(
      'Great, Tuesday at 10am it is.',
    );
    expect(repClosingLine([{ type: 'end_call', reason: 'done' }])).toBe(
      'Thanks for your time. Bye.',
    );
    expect(repClosingLine([])).toBeUndefined();
  });

  it('books the meeting before hanging up, so the call ends as booked', async () => {
    const order: string[] = [];
    const controller = {
      recordMeeting: vi.fn((when: string) => {
        order.push(`meeting:${when}`);
        return Promise.resolve();
      }),
      end: vi.fn((outcome: string) => {
        order.push(`end:${outcome}`);
        return Promise.resolve();
      }),
    };
    const record = vi.fn();
    const actions: RepAction[] = [
      { type: 'end_call', reason: 'Booked' },
      { type: 'book_meeting', when: 'Tuesday at 10am' },
    ];
    await actOnRepReply(actions, 7, { controller, logger: { info: vi.fn() }, record });
    expect(order).toEqual(['meeting:Tuesday at 10am', 'end:ended_by_rep']);
    expect(record).toHaveBeenCalledWith('meeting', {
      turn: 7,
      when: 'Tuesday at 10am',
      booked: true,
    });
  });
});

describe("Sam's request", () => {
  it('caches his system prompt and the call up to his last line, with his tools and no sampling', () => {
    const params = repRequest({
      model: 'claude-opus-5-5',
      effort: 'low',
      system: 'You are Sam.',
      messages: [
        { role: 'user', content: 'Voltline, Rachel speaking.' },
        { role: 'assistant', content: "Hi Rachel, it's Sam." },
        { role: 'user', content: 'Go on.' },
      ],
    });
    expect(params).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: REP_MAX_TOKENS,
      tools: REP_TOOLS,
      system: [{ type: 'text', text: 'You are Sam.', cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low' },
    });
    expect(params.messages[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: "Hi Rachel, it's Sam.", cache_control: { type: 'ephemeral' } },
      ],
    });
    for (const key of ['temperature', 'top_p', 'top_k', 'thinking', 'tool_choice']) {
      expect(params).not.toHaveProperty(key);
    }
  });
});

describe('a reverse call', () => {
  it('gives Sam REP_VOICE_ID, or the default voice, and checks a silent line by her first name', () => {
    expect(repVoice({ REP_VOICE_ID: 'voice-sam', CARTESIA_VOICE_ID: 'voice-default' })).toBe(
      'voice-sam',
    );
    expect(repVoice({ REP_VOICE_ID: undefined, CARTESIA_VOICE_ID: 'voice-default' })).toBe(
      'voice-default',
    );
    expect(repVoice({ REP_VOICE_ID: undefined, CARTESIA_VOICE_ID: undefined })).toBeUndefined();
    expect(nudgeLine('Rachel Byrne')).toBe('Hello? Is that Rachel?');
    expect(NUDGE_MS).toBeGreaterThanOrEqual(5_000);
  });

  it('lets the rep, playing her, only hang up: that is her ending the call', async () => {
    const controller = { phase: 'connected' as const, end: vi.fn(() => Promise.resolve()) };
    const controls = reverseControls(controller);
    expect(controls.pause()).toEqual({
      ok: false,
      reason: 'Pause is off in a reverse call: Sam is the one selling.',
    });
    await expect(controls.rewind()).resolves.toMatchObject({ ok: false });
    await expect(controls.hint()).rejects.toThrow('Help is off in a reverse call');
    expect(controls.resume()).toEqual({ ok: true });
    expect(controls.hangup()).toEqual({ ok: true });
    expect(controller.end).toHaveBeenCalledWith('hung_up_by_prospect');
  });
});
