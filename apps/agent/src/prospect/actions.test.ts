import type { CallOutcome } from '@ccc/contracts';
import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '../test/fixtures.ts';
import { OUT_OF_PATIENCE, actOnReply } from './actions.ts';
import type { MeetingDecision } from './brain.ts';
import type { Reply } from './replies.ts';

function setup(decision: MeetingDecision = { booked: true, when: 'Tuesday at 10am' }) {
  const calls: string[] = [];
  const deps = {
    brain: {
      agreeToMeeting: vi.fn((when: string, turn: number) => {
        calls.push(`agree:${when}@${turn}`);
        return Promise.resolve(decision);
      }),
    },
    controller: {
      recordMeeting: vi.fn((when: string) => {
        calls.push(`meeting:${when}`);
        return Promise.resolve();
      }),
      end: vi.fn((outcome: CallOutcome, reason?: string) => {
        calls.push(`end:${outcome}:${reason}`);
        return Promise.resolve();
      }),
    },
    logger: silentLogger,
  };
  return { deps, calls };
}

const reply = (patch: Partial<Reply>): Reply => ({
  id: 'r1',
  forcedGoodbye: false,
  actions: [],
  ...patch,
});

describe('actOnReply', () => {
  it('books the meeting when the rules allow it, and keeps talking', async () => {
    const { deps, calls } = setup();
    await actOnReply(reply({ actions: [{ type: 'agree_to_meeting', when: 'Tue 10' }] }), 4, deps);
    expect(calls).toEqual(['agree:Tue 10@4', 'meeting:Tuesday at 10am']);
  });

  it('records nothing when the rules refuse the meeting', async () => {
    const { deps, calls } = setup({ booked: false, reason: 'the rep never asked for a meeting' });
    await actOnReply(reply({ actions: [{ type: 'agree_to_meeting', when: 'Tue 10' }] }), 4, deps);
    expect(calls).toEqual(['agree:Tue 10@4']);
  });

  it('hangs up with her reason on end_call, after booking any meeting in the same reply', async () => {
    const { deps, calls } = setup();
    await actOnReply(
      reply({
        actions: [
          { type: 'end_call', reason: 'Booked; got to go' },
          { type: 'agree_to_meeting', when: 'Tue 10' },
        ],
      }),
      6,
      deps,
    );
    expect(calls).toEqual([
      'agree:Tue 10@6',
      'meeting:Tuesday at 10am',
      'end:hung_up_by_prospect:Booked; got to go',
    ]);
  });

  it('ends the call after a forced goodbye even if she forgot end_call', async () => {
    const { deps, calls } = setup();
    await actOnReply(reply({ forcedGoodbye: true }), 3, deps);
    expect(calls).toEqual([`end:hung_up_by_prospect:${OUT_OF_PATIENCE}`]);
  });

  it('does nothing for an ordinary reply', async () => {
    const { deps, calls } = setup();
    await actOnReply(reply({}), 2, deps);
    expect(calls).toEqual([]);
  });
});

describe('actOnReply, for the call log', () => {
  it('records each tool call and the meeting decision', async () => {
    const { deps } = setup({ booked: false, reason: 'the rep never asked for a meeting' });
    const record = vi.fn();
    await actOnReply(
      reply({
        actions: [
          { type: 'agree_to_meeting', when: 'Tue 10' },
          { type: 'end_call', reason: 'Busy' },
        ],
      }),
      3,
      { ...deps, record },
    );
    expect(record.mock.calls).toEqual([
      ['tool_call', { turn: 3, name: 'agree_to_meeting', when: 'Tue 10' }],
      [
        'meeting',
        { turn: 3, when: 'Tue 10', booked: false, reason: 'the rep never asked for a meeting' },
      ],
      ['tool_call', { turn: 3, name: 'end_call', reason: 'Busy' }],
    ]);
  });
});
