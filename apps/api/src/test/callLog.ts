// A short, realistic call log for the API's tests, and a stub reviewer.
import type { CallLog, CallStage, JudgementEventPayload, ReviewDraft } from '@ccc/contracts';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { LOCAL_USER_ID, calls } from '../db/schema.ts';
import type { Reviewer } from '../review/reviewer.ts';

export async function createCall(db: Db, scenarioId = 'medium-finance-director'): Promise<string> {
  const [call] = await db
    .insert(calls)
    .values({ userId: LOCAL_USER_ID, scenarioId, scenarioVersion: 1, mode: 'coached' })
    .returning({ id: calls.id });
  if (!call) throw new Error('no call row');
  return call.id;
}

export const deleteCall = (db: Db, id: string) => db.delete(calls).where(eq(calls.id, id));

const state = (turn: number, interest: number, patience: number) => ({
  turn,
  interest,
  patience,
  painsRevealed: [],
});

/** A `judgement` event's payload: the live judge's reading of rep turn `turn`. */
const judgement = (
  turn: number,
  stage: CallStage,
  signals: string[],
  patience: [number, number],
): JudgementEventPayload => ({
  turn,
  judged: true,
  stage,
  signals,
  revealEarned: null,
  interest: [20, 20],
  patience,
});

export function sampleLog(overrides: Partial<CallLog> = {}): CallLog {
  return {
    outcome: 'hung_up_by_prospect',
    reason: 'Out of patience',
    connectedAt: '2026-09-26T10:00:00.000Z',
    endedAt: '2026-09-26T10:01:30.000Z',
    durationMs: 90_000,
    turns: [
      {
        idx: 0,
        speaker: 'prospect',
        text: 'Claire Hughes.',
        startMs: 0,
        endMs: 900,
        words: null,
        interrupted: false,
        stateAfter: null,
      },
      {
        idx: 1,
        speaker: 'rep',
        text: "Hi Claire, it's Sam from WattGuard, sorry to bother you. Um, we do energy dashboards.",
        startMs: 1_500,
        endMs: 9_000,
        words: [
          { text: 'Hi', startMs: 1_500, endMs: 1_700 },
          { text: 'Claire,', startMs: 1_700, endMs: 2_100 },
        ],
        interrupted: false,
        stateAfter: state(1, 20, 44),
      },
      {
        idx: 2,
        speaker: 'prospect',
        text: "Right. I'm about to go into a meeting.",
        startMs: 9_600,
        endMs: 11_500,
        words: null,
        interrupted: false,
        stateAfter: state(0, 20, 55),
      },
      {
        idx: 3,
        speaker: 'rep',
        text: 'It will only take a minute. Can I send you some information?',
        startMs: 12_000,
        endMs: 16_000,
        words: null,
        interrupted: false,
        stateAfter: state(2, 20, 21),
      },
      {
        idx: 4,
        speaker: 'prospect',
        text: 'Just send me an email. Goodbye.',
        startMs: 16_500,
        endMs: 18_500,
        words: null,
        interrupted: false,
        stateAfter: state(1, 20, 44),
      },
    ],
    events: [
      {
        tMs: 9_200,
        kind: 'judgement',
        payload: judgement(1, 'opener', ['pitchedFeatures'], [55, 44]),
      },
      {
        tMs: 16_200,
        kind: 'judgement',
        payload: judgement(2, 'objection_handling', ['ignoredHerPoint', 'pushy'], [44, 21]),
      },
      { tMs: 18_600, kind: 'tool_call', payload: { name: 'end_call', reason: 'Out of patience' } },
      { tMs: 18_700, kind: 'outcome', payload: { outcome: 'hung_up_by_prospect' } },
    ],
    latency: [{ turn: 1, endOfTurnMs: 400, llmTtftMs: 700, ttsTtfbMs: 180, e2eMs: 1_300 }],
    usage: {
      prospect: {
        model: 'claude-opus-5',
        calls: 2,
        inputTokens: 1_800,
        cacheReadInputTokens: 1_200,
        cacheCreationInputTokens: 600,
        outputTokens: 90,
        costUsd: 0.01,
      },
      judge: {
        model: 'claude-opus-5',
        calls: 2,
        inputTokens: 2_400,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        outputTokens: 200,
        costUsd: 0.017,
      },
    },
    ...overrides,
  };
}

/** A draft as Claude might write it: one quote the rep never said. */
export const sampleDraft: ReviewDraft = {
  outcome: 'She hung up after a feature pitch and a pushy ask.',
  overallScore: 22,
  summary: 'You apologised, pitched features and pushed for a send-out.',
  stages: (['opener', 'reason', 'discovery', 'objections', 'next_step', 'delivery'] as const).map(
    (key) => ({
      key,
      score: key === 'opener' ? 2 : 1,
      evidence:
        key === 'opener'
          ? [
              { turn: 2, quote: 'sorry to bother you' },
              { turn: 2, quote: 'I promise to be quick' },
            ]
          : [],
      feedback: `Feedback on ${key}.`,
      nextTime: `Next time, on ${key}: ask first.`,
    }),
  ),
  moments: [
    {
      turn: 4,
      kind: 'mistake',
      stage: 'objections',
      quote: 'It will only take a minute.',
      whatHappened: 'She told you she was busy and you pushed on; her patience fell to 21.',
      sayInstead: 'Sounds like now is bad. When is better, Tuesday at ten?',
      why: 'Respect her time and ask for a specific slot.',
    },
    {
      turn: 3,
      kind: 'missed',
      stage: 'objections',
      quote: "I'm about to go into a meeting",
      whatHappened: 'A brush-off you could have turned into a callback.',
      sayInstead: 'Of course. Could I call you back at three?',
      why: 'Accept the brush-off and book the next touch.',
    },
    {
      turn: 2,
      kind: 'strong',
      stage: 'opener',
      quote: "it's Sam from WattGuard",
      whatHappened: 'You said who you were straight away.',
      sayInstead: 'ignored for a strong moment',
      why: 'She knows who is calling before she decides whether to listen.',
    },
  ],
  objections: [
    {
      turn: 3,
      objection: "I'm about to go into a meeting",
      yourResponse: 'It will only take a minute.',
      score: 1,
      better: 'Then I will be quick: can I call back at 3?',
    },
  ],
  strengths: ['You said who you were.'],
  priorities: ['Ask for thirty seconds before you pitch.', 'Offer a callback when she is busy.'],
  drill: {
    title: 'Permission openers',
    instructions: 'Practise asking for thirty seconds, ten times.',
  },
};

export function stubReviewer(draft: ReviewDraft = sampleDraft) {
  const calls: unknown[] = [];
  const reviewer: Reviewer = (input) => {
    calls.push(input);
    return Promise.resolve({
      draft,
      model: 'claude-opus-5',
      usage: {
        inputTokens: 5_000,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        outputTokens: 1_500,
      },
      costUsd: 0.0625,
    });
  };
  return { reviewer, calls };
}
