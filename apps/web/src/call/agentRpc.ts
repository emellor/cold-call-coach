// The rep's controls reach the agent over LiveKit RPC (PLAN.md §9). Every
// answer is validated against its contract; every failure becomes a sentence
// the call page can show as it is.
import { type RpcMethod, parseRpcResponse } from '@ccc/contracts';
import { type Room, RpcError } from 'livekit-client';
import type { z } from 'zod';

/** livekit-client clamps anything shorter to 8 s. Get help targets about 2 s. */
export const RPC_TIMEOUT_MS = 10_000;

/** A control that didn't happen, and why, in words for the rep. */
export class AgentRpcError extends Error {}

type RpcRoom = Pick<Room, 'remoteParticipants' | 'localParticipant'>;

/** The prospect agent's identity in the room: LiveKit marks agent participants. */
export function agentIdentity(room: Pick<Room, 'remoteParticipants'>): string | null {
  for (const participant of room.remoteParticipants.values()) {
    if (participant.isAgent) return participant.identity;
  }
  return null;
}

export function describeRpcError(error: unknown): string {
  if (error instanceof RpcError) {
    switch (error.code) {
      case RpcError.ErrorCode.APPLICATION_ERROR:
        return error.message; // the agent's own words
      case RpcError.ErrorCode.RESPONSE_TIMEOUT:
      case RpcError.ErrorCode.CONNECTION_TIMEOUT:
        return 'The agent took too long to answer.';
      case RpcError.ErrorCode.UNSUPPORTED_METHOD:
        return 'The agent is out of date: restart it (`pnpm dev`).';
      case RpcError.ErrorCode.RECIPIENT_DISCONNECTED:
      case RpcError.ErrorCode.RECIPIENT_NOT_FOUND:
        return 'The prospect has left the call.';
    }
  }
  return "Couldn't reach the agent.";
}

/** Calls one of the agent's control methods and returns its validated answer. */
export async function callAgent<S extends z.ZodType>(
  room: RpcRoom,
  rpc: RpcMethod<S>,
): Promise<z.infer<S>> {
  const destinationIdentity = agentIdentity(room);
  if (!destinationIdentity) throw new AgentRpcError('The prospect has left the call.');
  let text: string;
  try {
    text = await room.localParticipant.performRpc({
      destinationIdentity,
      method: rpc.name,
      payload: '',
      responseTimeout: RPC_TIMEOUT_MS,
    });
  } catch (error) {
    throw new AgentRpcError(describeRpcError(error));
  }
  try {
    return parseRpcResponse(rpc, text);
  } catch {
    throw new AgentRpcError("The agent's answer didn't make sense. Is it the same version?");
  }
}
