import { RpcMethods } from '@ccc/contracts';
import { RpcError } from 'livekit-client';
import { describe, expect, it, vi } from 'vitest';
import {
  AgentRpcError,
  RPC_TIMEOUT_MS,
  agentIdentity,
  callAgent,
  describeRpcError,
} from './agentRpc.ts';

function roomWith(
  answer: () => Promise<string>,
  participants = [{ identity: 'agent-AJ_1', isAgent: true }],
) {
  const performRpc = vi.fn(answer);
  const room = {
    remoteParticipants: new Map(participants.map((p) => [p.identity, p])),
    localParticipant: { performRpc },
  } as unknown as Parameters<typeof callAgent>[0];
  return { room, performRpc };
}

describe('agentIdentity', () => {
  it('finds the participant LiveKit marks as an agent', () => {
    const { room } = roomWith(
      () => Promise.resolve(''),
      [
        { identity: 'someone', isAgent: false },
        { identity: 'agent-AJ_1', isAgent: true },
      ],
    );
    expect(agentIdentity(room)).toBe('agent-AJ_1');
    expect(agentIdentity(roomWith(() => Promise.resolve(''), []).room)).toBeNull();
  });
});

describe('callAgent', () => {
  it('calls the agent with an empty payload and returns its validated answer', async () => {
    const { room, performRpc } = roomWith(() => Promise.resolve('{"ok":true}'));
    await expect(callAgent(room, RpcMethods.pause)).resolves.toEqual({ ok: true });
    expect(performRpc).toHaveBeenCalledWith({
      destinationIdentity: 'agent-AJ_1',
      method: 'call.pause',
      payload: '',
      responseTimeout: RPC_TIMEOUT_MS,
    });
  });

  it('rejects an answer that breaks the contract, or no agent to ask', async () => {
    const bad = roomWith(() => Promise.resolve('{"suggestions":[]}'));
    await expect(callAgent(bad.room, RpcMethods.hint)).rejects.toBeInstanceOf(AgentRpcError);
    const alone = roomWith(() => Promise.resolve('{"ok":true}'), []);
    await expect(callAgent(alone.room, RpcMethods.pause)).rejects.toThrow(
      'The prospect has left the call.',
    );
  });

  it('passes the agent’s own refusal through as it is', async () => {
    const { room } = roomWith(() =>
      Promise.reject(
        new RpcError(RpcError.ErrorCode.APPLICATION_ERROR, 'Hint is off in exam mode.'),
      ),
    );
    await expect(callAgent(room, RpcMethods.hint)).rejects.toThrow('Hint is off in exam mode.');
  });
});

describe('describeRpcError', () => {
  it('names what went wrong in words the rep can act on', () => {
    const rpc = (code: number) => new RpcError(code, 'raw');
    expect(describeRpcError(rpc(RpcError.ErrorCode.RESPONSE_TIMEOUT))).toBe(
      'The agent took too long to answer.',
    );
    expect(describeRpcError(rpc(RpcError.ErrorCode.UNSUPPORTED_METHOD))).toMatch(/out of date/);
    expect(describeRpcError(rpc(RpcError.ErrorCode.RECIPIENT_DISCONNECTED))).toBe(
      'The prospect has left the call.',
    );
    expect(describeRpcError(new Error('boom'))).toBe("Couldn't reach the agent.");
  });
});
