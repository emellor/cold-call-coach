import {
  type CallMode,
  type CallNoticePayload,
  type CallOutcome,
  type CoachMetricsPayload,
  type CoachTipPayload,
  type CreateCallRequest,
  type DebugLatencyPayload,
  type HintResponse,
  type ProspectStatePayload,
  RpcMethods,
  type StageStatus,
  type Topic,
  Topics,
  type TrackerStage,
  parseTopicMessage,
} from '@ccc/contracts';
import {
  ConnectionError,
  ConnectionErrorReason,
  DisconnectReason,
  Room,
  RoomEvent,
} from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { playHangUpClick } from '../audio/click.ts';
import { RingTone } from '../audio/ringTone.ts';
import { ApiRequestError, createCall } from '../lib/api.ts';
import { AgentRpcError, callAgent } from './agentRpc.ts';

export type CallPhase = 'idle' | 'dialling' | 'ringing' | 'connected' | 'ended';

export type StageMap = Record<TrackerStage, StageStatus>;

export const NO_STAGES: StageMap = {
  opener: 'pending',
  reason: 'pending',
  discovery: 'pending',
  objections: 'pending',
  next_step: 'pending',
};

/** The live coach's feed (coached calls only; an exam call never fills it). */
export interface CoachView {
  metrics?: CoachMetricsPayload;
  stages: StageMap;
  /** The latest tip; the card fades it after 8 s. */
  tip?: CoachTipPayload;
}

/** Get help (the hint RPC): what to say now, why, and what to say if she pushes back. */
export type HintView =
  | { status: 'loading' }
  | { status: 'ready'; help: HintResponse }
  | { status: 'error'; message: string };

/** A line about the last control: rewound, couldn't pause… */
export interface Notice {
  id: number;
  text: string;
  tone: 'info' | 'error';
}

export interface CallView {
  phase: CallPhase;
  callId?: string;
  mode?: CallMode;
  /** Kept after the call ends so the transcript stays on screen. */
  room?: Room;
  connectedAt?: number;
  outcome?: CallOutcome;
  /** Why the call ended, in words for the rep. */
  message?: string;
  latency: DebugLatencyPayload[];
  /** Her latest mood and hidden numbers. The page shows none of them. */
  prospect?: ProspectStatePayload;
  /** Set once a meeting is booked: the slot she agreed to ('' if the agent sent none). */
  meeting?: string;
  coach: CoachView;
  /** The rep paused the call: their mic is muted and she waits. */
  paused: boolean;
  /** A pause, resume or rewind waiting on the agent. */
  busy?: 'pause' | 'resume' | 'rewind';
  hint?: HintView;
  notice?: Notice;
  /** The agent's notices (a provider failing, the cost warning), the latest of each kind. */
  agentNotices: CallNoticePayload[];
  /** LiveKit lost the connection and is getting it back; the call goes on if it does. */
  reconnecting: boolean;
}

/** Hang up if nobody answers: usually the agent worker isn't running. */
export const NO_ANSWER_MS = 30_000;

/** How long "Call ended" shows before the page moves on to the review. */
export const REVIEW_REDIRECT_MS = 1_500;

/** How long hanging up waits for the agent to hear about it before leaving the room. */
export const HANG_UP_GRACE_MS = 1_000;

const idleView = (): CallView => ({
  phase: 'idle',
  latency: [],
  coach: { stages: NO_STAGES },
  paused: false,
  agentNotices: [],
  reconnecting: false,
});

/** Where to go once the call is over: its review, if she ever picked up. */
export const reviewPathAfter = (
  view: Pick<CallView, 'phase' | 'connectedAt' | 'callId'>,
): string | null =>
  view.phase === 'ended' && view.connectedAt !== undefined && view.callId
    ? `/calls/${view.callId}`
    : null;

const OUTCOME_MESSAGES: Record<CallOutcome, string> = {
  meeting_booked: 'Meeting booked.',
  hung_up_by_prospect: 'She hung up.',
  ended_by_rep: 'You hung up.',
  timeout: 'The 15-minute limit was reached.',
  error: 'The call failed.',
};

/**
 * The ended-call message: the outcome, plus the agent's reason where it adds
 * something. In a reverse call the rep is her and Sam is the rep.
 */
export function describeOutcome(
  outcome: CallOutcome,
  reason?: string,
  mode: CallMode = 'coached',
): string {
  if (mode === 'reverse') {
    switch (outcome) {
      case 'meeting_booked':
        return reason ? `Sam booked the meeting: ${reason}.` : 'Sam booked the meeting.';
      case 'hung_up_by_prospect':
        return 'You hung up.';
      case 'ended_by_rep':
        return 'Sam ended the call.';
      case 'timeout':
      case 'error':
        return reason ?? OUTCOME_MESSAGES[outcome];
    }
  }
  switch (outcome) {
    case 'meeting_booked':
      return reason ? `Meeting booked: ${reason}.` : OUTCOME_MESSAGES.meeting_booked;
    case 'hung_up_by_prospect':
      return reason ? `She hung up. Her reason: “${reason}”` : OUTCOME_MESSAGES.hung_up_by_prospect;
    case 'ended_by_rep':
      return OUTCOME_MESSAGES.ended_by_rep;
    case 'timeout':
    case 'error':
      return reason ?? OUTCOME_MESSAGES[outcome];
  }
}

/** LiveKit refused the token the API minted: the API's key pair isn't one LiveKit knows. */
export const LIVEKIT_REFUSED_TOKEN =
  "LiveKit refused this call's token, so the API's LIVEKIT_API_KEY and LIVEKIT_API_SECRET " +
  "aren't a key and secret from the LiveKit project in LIVEKIT_URL.";

export function describeDialError(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof ConnectionError) {
    if (error.reason === ConnectionErrorReason.NotAllowed || error.status === 401) {
      return LIVEKIT_REFUSED_TOKEN;
    }
    if (error.reason === ConnectionErrorReason.ServerUnreachable) {
      return "Couldn't reach LiveKit. Check your connection, and LIVEKIT_URL on the API.";
    }
  }
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Microphone access was blocked. Allow it for this site and dial again.';
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return 'No microphone was found. Plug in your headset and dial again.';
  }
  return `Couldn't connect the call: ${error instanceof Error ? error.message : String(error)}`;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

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

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export function useCall() {
  const [view, setView] = useState<CallView>(idleView);
  const roomRef = useRef<Room | null>(null);
  const ringRef = useRef<RingTone | null>(null);
  const noAnswerRef = useRef<number | undefined>(undefined);
  /** True from joining the room until the call ends: only such a call ends with a click. */
  const liveRef = useRef(false);
  /** What the controls need to know without waiting for a render. */
  const callRef = useRef<{ mode: CallMode; connected: boolean; paused: boolean }>({
    mode: 'coached',
    connected: false,
    paused: false,
  });
  const busyRef = useRef(false);
  const hintingRef = useRef(false);
  const noticeRef = useRef(0);

  const stopRinging = useCallback(() => {
    ringRef.current?.stop();
    ringRef.current = null;
    window.clearTimeout(noAnswerRef.current);
  }, []);

  const finish = useCallback(
    (outcome: CallOutcome | undefined, reason?: string, before?: Promise<void>) => {
      stopRinging();
      if (liveRef.current) {
        liveRef.current = false;
        playHangUpClick();
      }
      callRef.current = { ...callRef.current, connected: false, paused: false };
      const room = roomRef.current;
      roomRef.current = null;
      setView((v) => {
        if (v.phase === 'ended' || v.phase === 'idle') return v;
        const ended = {
          ...v,
          phase: 'ended' as const,
          paused: false,
          busy: undefined,
          reconnecting: false,
        };
        // As on the agent: a booked meeting is the outcome however the call ends,
        // including when the rep hangs up first and misses the agent's last word.
        if (v.meeting !== undefined) {
          return {
            ...ended,
            outcome: 'meeting_booked',
            message: describeOutcome('meeting_booked', v.meeting || undefined, v.mode),
          };
        }
        return {
          ...ended,
          outcome,
          message: outcome ? describeOutcome(outcome, reason, v.mode) : reason,
        };
      });
      if (!room) return;
      if (before)
        void Promise.race([before, sleep(HANG_UP_GRACE_MS)]).then(() => room.disconnect());
      else void room.disconnect();
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
      callRef.current = { mode: request.mode, connected: false, paused: false };
      void room.startAudio();
      setView({ ...idleView(), phase: 'dialling', room, mode: request.mode });

      onTopic(room, Topics.callState, (state) => {
        if (state.phase === 'connected') {
          stopRinging();
          callRef.current.connected = true;
          setView((v) => ({
            ...v,
            phase: 'connected',
            connectedAt: v.connectedAt ?? Date.now(),
            // A meeting is announced mid-call, as a connected state with an outcome.
            ...(state.outcome === 'meeting_booked'
              ? { meeting: state.reason ?? '', outcome: state.outcome }
              : {}),
          }));
        } else if (state.phase === 'ended') {
          finish(state.outcome, state.reason);
        }
      });
      onTopic(room, Topics.prospectState, (prospect) => {
        setView((v) => ({ ...v, prospect }));
      });
      onTopic(room, Topics.debugLatency, (latency) => {
        setView((v) => ({ ...v, latency: [...v.latency, latency] }));
      });
      onTopic(room, Topics.coachMetrics, (metrics) => {
        setView((v) => ({ ...v, coach: { ...v.coach, metrics } }));
      });
      onTopic(room, Topics.coachStage, ({ stage, status }) => {
        setView((v) => ({
          ...v,
          coach: { ...v.coach, stages: { ...v.coach.stages, [stage]: status } },
        }));
      });
      onTopic(room, Topics.coachTip, (tip) => {
        setView((v) => ({ ...v, coach: { ...v.coach, tip } }));
      });
      onTopic(room, Topics.callNotice, (notice) => {
        setView((v) => ({
          ...v,
          agentNotices: [...v.agentNotices.filter((n) => n.code !== notice.code), notice],
        }));
      });
      // A dropped connection is retried by LiveKit; the call only ends if that fails.
      room.on(RoomEvent.Reconnecting, () => setView((v) => ({ ...v, reconnecting: true })));
      room.on(RoomEvent.Reconnected, () => setView((v) => ({ ...v, reconnecting: false })));
      // Only a call that got through can drop: LiveKit also reports a failed
      // connect as a disconnect, and the dial's own error says more about it.
      room.on(RoomEvent.Disconnected, (reason) => {
        if (reason !== DisconnectReason.CLIENT_INITIATED && liveRef.current) {
          finish('error', "The connection dropped and couldn't be restored.");
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
          () =>
            finish(
              'error',
              'No answer: the voice agent never picked up. Check that it is running and ' +
                'connected to LiveKit (`pnpm dev` starts it locally).',
            ),
          NO_ANSWER_MS,
        );
      } catch (error) {
        finish('error', describeDialError(error));
      }
    },
    [finish, stopRinging],
  );

  const hangUp = useCallback(() => {
    const room = roomRef.current;
    // Tell the agent, so it ends the call as the rep's hang-up; never wait long for it.
    const told =
      room && callRef.current.connected
        ? callAgent(room, RpcMethods.hangup).then(
            () => undefined,
            () => undefined,
          )
        : undefined;
    // In a reverse call the rep is her, so hanging up is her ending the call.
    finish(
      callRef.current.mode === 'reverse' ? 'hung_up_by_prospect' : 'ended_by_rep',
      undefined,
      told,
    );
  }, [finish]);

  const notify = useCallback((text: string, tone: Notice['tone']) => {
    const id = ++noticeRef.current;
    setView((v) => ({ ...v, notice: { id, text, tone } }));
  }, []);

  const setPaused = useCallback((paused: boolean) => {
    callRef.current.paused = paused;
    setView((v) => ({ ...v, paused }));
  }, []);

  /** Runs one pause, resume or rewind at a time, in a coached call she has answered. */
  const control = useCallback(
    async (kind: NonNullable<CallView['busy']>, run: (room: Room) => Promise<void>) => {
      const room = roomRef.current;
      const { mode, connected } = callRef.current;
      if (!room || !connected || mode !== 'coached' || busyRef.current) return;
      busyRef.current = true;
      setView((v) => ({ ...v, busy: kind }));
      try {
        await run(room);
      } catch (error) {
        if (roomRef.current === room) notify(messageOf(error), 'error');
      } finally {
        busyRef.current = false;
        setView((v) => ({ ...v, busy: undefined }));
      }
    },
    [notify],
  );

  // Pause mutes the mic first, so nothing leaks while the agent catches up.
  const pause = useCallback(
    () =>
      control('pause', async (room) => {
        if (callRef.current.paused) return;
        setPaused(true);
        try {
          await room.localParticipant.setMicrophoneEnabled(false);
          const answer = await callAgent(room, RpcMethods.pause);
          if (!answer.ok) throw new AgentRpcError(answer.reason ?? "Couldn't pause the call.");
        } catch (error) {
          setPaused(false);
          await room.localParticipant.setMicrophoneEnabled(true).catch(() => undefined);
          throw error;
        }
      }),
    [control, setPaused],
  );

  // Resume waits for the agent to listen again before unmuting, so no word is lost.
  const resume = useCallback(
    () =>
      control('resume', async (room) => {
        if (!callRef.current.paused) return;
        const answer = await callAgent(room, RpcMethods.resume);
        if (!answer.ok) throw new AgentRpcError(answer.reason ?? "Couldn't resume the call.");
        await room.localParticipant.setMicrophoneEnabled(true);
        setPaused(false);
      }),
    [control, setPaused],
  );

  const togglePause = useCallback(
    () => (callRef.current.paused ? resume() : pause()),
    [pause, resume],
  );

  const rewind = useCallback(
    () =>
      control('rewind', async (room) => {
        setView((v) => ({ ...v, hint: undefined }));
        const answer = await callAgent(room, RpcMethods.rewind);
        if (!answer.ok) {
          notify(answer.reason ?? "Couldn't rewind.", 'info');
          return;
        }
        // The agent resumes a paused call as it rewinds.
        if (callRef.current.paused) {
          await room.localParticipant.setMicrophoneEnabled(true);
          setPaused(false);
        }
        notify("Rewound. She'll say her line again: retake your turn.", 'info');
      }),
    [control, notify, setPaused],
  );

  const hint = useCallback(async () => {
    const room = roomRef.current;
    const { mode, connected } = callRef.current;
    if (!room || !connected || mode !== 'coached' || hintingRef.current) return;
    hintingRef.current = true;
    setView((v) => ({ ...v, hint: { status: 'loading' } }));
    try {
      const help = await callAgent(room, RpcMethods.hint);
      if (roomRef.current === room) {
        setView((v) => ({ ...v, hint: { status: 'ready', help } }));
      }
    } catch (error) {
      if (roomRef.current === room) {
        setView((v) => ({ ...v, hint: { status: 'error', message: messageOf(error) } }));
      }
    } finally {
      hintingRef.current = false;
    }
  }, []);

  const dismissHint = useCallback(() => setView((v) => ({ ...v, hint: undefined })), []);

  const dismissAgentNotice = useCallback(
    (code: CallNoticePayload['code']) =>
      setView((v) => ({ ...v, agentNotices: v.agentNotices.filter((n) => n.code !== code) })),
    [],
  );

  // Leaving the page mid-call hangs up.
  useEffect(() => () => finish('ended_by_rep'), [finish]);

  return { view, dial, hangUp, togglePause, hint, dismissHint, rewind, dismissAgentNotice };
}
