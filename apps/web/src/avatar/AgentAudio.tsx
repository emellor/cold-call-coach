import {
  RoomAudioRenderer,
  useIsSpeaking,
  useLocalParticipant,
  useVoiceAssistant,
} from '@livekit/components-react';
import { useEffect } from 'react';
import type { AvatarController } from './AvatarController.ts';

/**
 * Routes the prospect's audio track into the avatar, whose audio graph both
 * plays it and drives the lips. Not RoomAudioRenderer as well: that would play
 * her twice. Only when there is no avatar controller (no WebGL) does her voice
 * fall back to a plain audio element.
 */
export function AgentAudio({ controller }: { controller: AvatarController | null }) {
  const { audioTrack, state } = useVoiceAssistant();
  const { localParticipant } = useLocalParticipant();
  const repSpeaking = useIsSpeaking(localParticipant);
  const mediaStreamTrack = audioTrack?.publication?.track?.mediaStreamTrack;

  useEffect(() => {
    if (!controller || !mediaStreamTrack) return;
    controller.attachAgentTrack(mediaStreamTrack);
    return () => controller.detachAgentTrack();
  }, [controller, mediaStreamTrack]);

  // While the rep talks and she's listening: occasional eye contact and nods.
  useEffect(() => {
    controller?.setListening(repSpeaking && state === 'listening');
  }, [controller, repSpeaking, state]);
  useEffect(() => () => controller?.setListening(false), [controller]);

  return controller ? null : <RoomAudioRenderer />;
}
