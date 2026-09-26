import {
  type DispatchMetadata,
  MAX_CALL_SECONDS,
  PROSPECT_AGENT_NAME,
  REP_IDENTITY,
  roomNameForCall,
} from '@ccc/contracts';
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from 'livekit-server-sdk';
import type { LiveKitConfig } from './config.ts';

/**
 * A token for the rep to join this call's room. Joining creates the room, and
 * the room configuration dispatches the prospect agent into it with the call's
 * metadata (PLAN.md §5, step 1).
 */
export async function mintRepToken(
  livekit: LiveKitConfig,
  meta: DispatchMetadata,
): Promise<string> {
  const token = new AccessToken(livekit.apiKey, livekit.apiSecret, {
    identity: REP_IDENTITY,
    ttl: MAX_CALL_SECONDS,
  });
  token.addGrant({
    roomJoin: true,
    room: roomNameForCall(meta.callId),
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  token.roomConfig = new RoomConfiguration({
    agents: [
      new RoomAgentDispatch({
        agentName: PROSPECT_AGENT_NAME,
        metadata: JSON.stringify(meta),
      }),
    ],
  });
  return token.toJwt();
}
