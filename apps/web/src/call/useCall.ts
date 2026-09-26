import {
  type CallOutcome,
  type CreateCallRequest,
  type DebugLatencyPayload,
  type Topic,
  Topics,
  parseTopicMessage,
} from '@ccc/contracts';
import { DisconnectReason, Room, RoomEvent } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { playHangUpClick } from '../audio/click.ts';
import { RingTone } from '../audio/ringTone.ts';
import { ApiRequestError, createCall } from '../lib/api.ts';

export type CallPhase = 'idle' | 'dialling' | 'ringing' | 'connected' | 'ended';

export interface CallView {
  phase: CallPhase;
  callId?: string;
  /** Kept after the call ends so the transcript stays on screen. */
  room?: Room;
  connectedAt?: number;
  outcome?: CallOutcome;
  /** Why the call ended, in words for the rep. */
  message?: string;
  latency: DebugLatencyPayload[];
}

/** Hang up if nobody answers: usually the agent worker isn't running. */
export const NO_ANSWER_MS = 30_000;

const OUTCOME_MESSAGES: Record<CallOutcome, string> = {
  meeting_booked: 'Meeting booked.',
  hung_up_by_prospect: 'She hung up.',
  ended_by_rep: 'You hung up.',
  timeout: 'The 15-minute limit was reached.',
  error: 'The call failed.',
};

export function describeDialError(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Microphone access was blocked. Allow it for this site and dial again.';
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return 'No microphone was found. Plug in your headset and dial again.';
  }
  return `Couldn't connect the call: ${error instanceof Error ? error.message : String(error)}`;
}

/** Calls `handle` with each valid message on the topic; invalid ones are dropped. */
function onTopic<S extends z.ZodType>(
  room: Room,
  topic: Topic<S>,
  handle: (payload: z.infer<S>) => void,
) {
  room.registerTextStreamHandler(topic.name, (reader) => {
    void reader.readAll().then((text) => {
      const payload = parseTopicMessage(topic, text);
      if (payload !== null) handle(payload);
    });
  });
}

export function useCall() {
  const [view, setView] = useState<CallView>({ phase: 'idle', latency: [] });
  const roomRef = useRef<Room | null>(null);
  const ringRef = useRef<RingTone | null>(null);
  const noAnswerRef = useRef<number | undefined>(undefined);
  /** True from joining the room until the call ends: only such a call ends with a click. */
  const liveRef = useRef(false);

  const stopRinging = useCallback(() => {
    ringRef.current?.stop();
    ringRef.current = null;
    window.clearTimeout(noAnswerRef.current);
  }, []);

  const finish = useCallback(
    (outcome: CallOutcome | undefined, message?: string) => {
      stopRinging();
      if (liveRef.current) {
        liveRef.current = false;
        playHangUpClick();
      }
      const room = roomRef.current;
      roomRef.current = null;
      setView((v) =>
        v.phase === 'ended' || v.phase === 'idle'
          ? v
          : {
              ...v,
              phase: 'ended',
              outcome,
              message: message ?? (outcome ? OUTCOME_MESSAGES[outcome] : undefined),
            },
      );
      void room?.disconnect();
    },
    [stopRinging],
  );

  const dial = useCallback(
    async (request: CreateCallRequest) => {
      if (roomRef.current) return;
      // Both must start inside the click: browsers only allow audio from a user gesture.
      ringRef.current = RingTone.start();
      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      void room.startAudio();
      setView({ phase: 'dialling', room, latency: [] });

      onTopic(room, Topics.callState, (state) => {
        if (state.phase === 'connected') {
          stopRinging();
          setView((v) => ({ ...v, phase: 'connected', connectedAt: Date.now() }));
        } else if (state.phase === 'ended') {
          finish(state.outcome, state.reason);
        }
      });
      onTopic(room, Topics.debugLatency, (latency) => {
        setView((v) => ({ ...v, latency: [...v.latency, latency] }));
      });
      room.on(RoomEvent.Disconnected, (reason) => {
        if (reason !== DisconnectReason.CLIENT_INITIATED) {
          finish('error', 'The connection dropped.');
        }
      });

      try {
        const call = await createCall(request);
        await room.connect(call.url, call.token);
        liveRef.current = true;
        setView((v) =>
          v.phase === 'dialling' ? { ...v, phase: 'ringing', callId: call.callId } : v,
        );
        await room.localParticipant.setMicrophoneEnabled(true);
        noAnswerRef.current = window.setTimeout(
          () => finish('error', 'No answer. Is the agent running? `pnpm dev` starts it.'),
          NO_ANSWER_MS,
        );
      } catch (error) {
        finish('error', describeDialError(error));
      }
    },
    [finish, stopRinging],
  );

  const hangUp = useCallback(() => finish('ended_by_rep'), [finish]);

  // Leaving the page mid-call hangs up.
  useEffect(() => () => finish('ended_by_rep'), [finish]);

  return { view, dial, hangUp };
}
