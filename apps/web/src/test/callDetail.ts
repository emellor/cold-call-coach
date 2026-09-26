import type { CallDetail, CallReview, ReviewResult } from '@ccc/contracts';

export const CALL_ID = '7b0a4e2c-2b1f-4f55-9a0c-6d3f1c1e8a10';

export const reviewResult: ReviewResult = {
  outcome: 'She hung up after a feature pitch.',
  overallScore: 38,
  summary: 'You opened well but pitched features before finding a problem.',
  stages: [
    {
      key: 'opener',
      score: 4,
      evidence: [{ turn: 2, quote: 'Have you got thirty seconds?' }],
      feedback: 'Good permission ask.',
    },
    {
      key: 'reason',
      score: 2,
      evidence: [{ turn: 4, quote: 'We do per-site dashboards' }],
      feedback: 'Lead with her problem.',
    },
    { key: 'discovery', score: 1, evidence: [], feedback: 'No open questions.' },
    { key: 'objections', score: 2, evidence: [], feedback: 'Acknowledge first.' },
    { key: 'next_step', score: 1, evidence: [], feedback: 'No specific ask.' },
    { key: 'delivery', score: 3, evidence: [], feedback: 'A little fast.' },
  ],
  topMoments: [
    {
      turn: 4,
      youSaid: 'We do per-site dashboards',
      tryInstead: 'Finance directors tell me energy bills are the line the board asks about most.',
      why: 'Lead with a problem she recognises.',
    },
  ],
  objections: [
    {
      turn: 4,
      objection: "I'm about to go into a meeting",
      yourResponse: 'We do per-site dashboards',
      score: 1,
      better: 'Then I will be quick: is 3pm better?',
    },
  ],
  strengths: ['Clear opener'],
  drill: { title: 'Problem-first reasons', instructions: 'Write three reasons in her words.' },
  quotesDropped: 1,
};

const review = (patch: Partial<CallReview>): CallReview => ({
  status: 'ready',
  result: reviewResult,
  error: null,
  model: 'claude-opus-5',
  costUsd: 0.0625,
  updatedAt: '2026-09-26T10:02:00.000Z',
  ...patch,
});

export function callDetail(reviewPatch: Partial<CallReview> | null = {}): CallDetail {
  return {
    call: {
      id: CALL_ID,
      startedAt: '2026-09-26T10:00:00.000Z',
      mode: 'coached',
      status: 'ended',
      outcome: 'hung_up_by_prospect',
      durationMs: 83_000,
      scenario: {
        id: 'medium-finance-director',
        version: 1,
        title: 'Busy finance director',
        difficulty: 'medium',
        prospectName: 'Claire Hughes',
      },
      overallScore: reviewPatch === null ? null : 38,
      reviewStatus: reviewPatch === null ? null : (reviewPatch.status ?? 'ready'),
    },
    outcomeReason: 'Out of patience',
    turns: [
      {
        idx: 0,
        speaker: 'prospect',
        text: 'Claire Hughes.',
        startMs: 0,
        endMs: 900,
        interrupted: false,
        stateAfter: null,
      },
      {
        idx: 1,
        speaker: 'rep',
        text: "Hi Claire, it's Sam from WattGuard. Have you got thirty seconds?",
        startMs: 1_200,
        endMs: 5_000,
        interrupted: false,
        stateAfter: { turn: 1, interest: 20, patience: 62, painsRevealed: [] },
      },
      {
        idx: 2,
        speaker: 'prospect',
        text: "I'm about to go into a meeting",
        startMs: 5_500,
        endMs: 7_000,
        interrupted: true,
        stateAfter: null,
      },
      {
        idx: 3,
        speaker: 'rep',
        text: 'We do per-site dashboards, anomaly alerts and ESOS reporting.',
        startMs: 7_100,
        endMs: 12_000,
        interrupted: false,
        stateAfter: { turn: 2, interest: 20, patience: 43, painsRevealed: [] },
      },
    ],
    metrics: {
      durationSec: 83,
      repSpeechSec: 8.7,
      prospectSpeechSec: 2.4,
      talkRatio: 0.78,
      repWords: 23,
      repWpm: 159,
      coreFillers: 0,
      softFillers: 0,
      fillersPerMin: 0,
      questionsOpen: 0,
      questionsClosed: 1,
      longestMonologueSec: 4.9,
      interruptions: 1,
      timeToFirstQuestionSec: 5,
    },
    review: reviewPatch === null ? null : review(reviewPatch),
  };
}
