// How she took each rep turn, read back from the call's `judgement` events, so
// the review can say what a turn did to her and not only what it said.
import {
  type CallStage,
  type FactKey,
  JudgementEventPayload,
  type JudgeSignals,
  type Speaker,
} from '@ccc/contracts';
import type { ControlEvent } from './controls.ts';

export interface TurnReaction {
  /** Before and after the turn, 0 to 100. */
  interest: readonly [number, number];
  patience: readonly [number, number];
  /** The live judge's reading; null when it failed on the turn. */
  reading: { stage: CallStage; signals: string[]; revealed: FactKey | null } | null;
}

/**
 * Each transcript turn's reaction: set on rep turns that were judged, undefined
 * everywhere else. Judgements count rep turns from 1 and a rewind reuses the
 * number for the retake, so the last event for a number is the one that
 * stands, and it belongs to the transcript's rep turn with that number.
 */
export function turnReactions(
  turns: readonly { speaker: Speaker }[],
  events: readonly ControlEvent[],
): (TurnReaction | undefined)[] {
  const byRepTurn = new Map<number, JudgementEventPayload>();
  for (const event of events) {
    if (event.kind !== 'judgement') continue;
    const parsed = JudgementEventPayload.safeParse(event.payload);
    if (parsed.success) byRepTurn.set(parsed.data.turn, parsed.data);
  }
  let repTurn = 0;
  return turns.map((turn) => {
    if (turn.speaker !== 'rep') return undefined;
    const judgement = byRepTurn.get(++repTurn);
    if (!judgement) return undefined;
    return {
      interest: judgement.interest,
      patience: judgement.patience,
      reading: judgement.judged
        ? {
            stage: judgement.stage,
            signals: judgement.signals,
            revealed: judgement.revealEarned,
          }
        : null,
    };
  });
}

const SIGNAL_WORDS: Record<keyof JudgeSignals, string> = {
  askedPermission: 'asked permission',
  gaveRelevantReason: 'gave a relevant reason',
  askedOpenQuestion: 'asked an open question',
  followedUp: 'followed up on what she said',
  acknowledgedObjection: 'acknowledged her objection',
  pitchedFeatures: 'pitched features',
  ignoredHerPoint: 'ignored her point',
  pushy: 'pushy',
  rude: 'rude',
  askedForMeeting: 'asked for a meeting',
  proposedSpecificTime: 'proposed a specific time',
};

const STAGE_WORDS: Record<CallStage, string> = {
  opener: 'opener',
  reason: 'reason for the call',
  discovery: 'discovery',
  pitch: 'pitch',
  objection_handling: 'objection handling',
  close: 'close',
  other: 'other',
};

export const signalWords = (name: string): string =>
  SIGNAL_WORDS[name as keyof JudgeSignals] ?? name;

export const stageWords = (stage: CallStage): string => STAGE_WORDS[stage];
