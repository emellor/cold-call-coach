import type { CallDetail, CallReview, CallTurn, RepNotes, ReviewResult } from '@ccc/contracts';

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
      nextTime: 'Keep the permission ask, and give your reason straight after it.',
    },
    {
      key: 'reason',
      score: 2,
      evidence: [{ turn: 4, quote: 'We do per-site dashboards' }],
      feedback: 'Lead with her problem.',
      nextTime: 'Say what finance directors like her struggle with before naming a feature.',
    },
    { key: 'discovery', score: 1, evidence: [], feedback: 'No open questions.', nextTime: '' },
    { key: 'objections', score: 2, evidence: [], feedback: 'Acknowledge first.', nextTime: '' },
    { key: 'next_step', score: 1, evidence: [], feedback: 'No specific ask.', nextTime: '' },
    { key: 'delivery', score: 3, evidence: [], feedback: 'A little fast.', nextTime: '' },
  ],
  moments: [
    {
      turn: 2,
      kind: 'strong',
      stage: 'opener',
      quote: 'Have you got thirty seconds?',
      whatHappened: 'You asked for her time before you pitched.',
      sayInstead: '',
      why: 'Asking permission lowers her guard.',
    },
    {
      turn: 3,
      kind: 'missed',
      stage: 'objections',
      quote: "I'm about to go into a meeting",
      whatHappened: 'She gave you the chance to book a callback.',
      sayInstead: 'Of course. Could I call you back at three?',
      why: 'Accept the brush-off and book the next conversation.',
    },
    {
      turn: 4,
      kind: 'mistake',
      stage: 'reason',
      quote: 'We do per-site dashboards',
      whatHappened:
        'You listed features before finding a problem; her patience fell from 62 to 43.',
      sayInstead: 'Finance directors tell me energy bills are the line the board asks about most.',
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
  priorities: [
    'Lead with her problem, not your features.',
    'When she is busy, offer a callback at a specific time.',
    'Ask one open question before you pitch anything.',
  ],
  drill: { title: 'Problem-first reasons', instructions: 'Write three reasons in her words.' },
  quotesDropped: 1,
};

/** A review stored before the walkthrough: three top moments, no priorities or next-time notes. */
export const olderReviewResult: ReviewResult = {
  outcome: reviewResult.outcome,
  overallScore: reviewResult.overallScore,
  summary: reviewResult.summary,
  stages: reviewResult.stages.map(({ key, score, evidence, feedback }) => ({
    key,
    score,
    evidence,
    feedback,
  })),
  topMoments: [
    {
      turn: 4,
      youSaid: 'We do per-site dashboards',
      tryInstead: 'Finance directors tell me energy bills are the line the board asks about most.',
      why: 'Lead with a problem she recognises.',
    },
  ],
  objections: reviewResult.objections,
  strengths: reviewResult.strengths,
  drill: reviewResult.drill,
  quotesDropped: 0,
};

const review = (patch: Partial<CallReview>): CallReview => ({
  status: 'ready',
  result: reviewResult,
  notes: null,
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
      costUsd: 0.2918,
      overBudget: false,
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
    cost: {
      totalUsd: 0.2918,
      lines: [
        {
          key: 'prospect',
          model: 'claude-opus-5',
          quantity: 25_900,
          unit: 'tokens',
          cachedTokens: 20_000,
          usd: 0.0865,
        },
        { key: 'judge', model: 'claude-opus-5', quantity: 18_200, unit: 'tokens', usd: 0.0421 },
        { key: 'review', model: 'claude-opus-5', quantity: null, unit: 'tokens', usd: 0.0625 },
        { key: 'stt', model: 'nova-3', quantity: 1.38, unit: 'minutes', usd: 0.0106 },
        { key: 'tts', model: 'sonic-3', quantity: 1_802, unit: 'characters', usd: 0.0901 },
      ],
      incomplete: false,
      warnAboveUsd: 2,
      overBudget: false,
    },
  };
}

const turn = (idx: number, speaker: CallTurn['speaker'], text: string): CallTurn => ({
  idx,
  speaker,
  text,
  startMs: idx * 3_000,
  endMs: idx * 3_000 + 2_000,
  interrupted: false,
  stateAfter: null,
});

export const repNotes: RepNotes = {
  notes: [
    {
      turn: 2,
      technique: 'Permission opener',
      note: 'She gets to say yes before any pitch, so she keeps listening.',
    },
    {
      turn: 4,
      technique: 'Specific close',
      note: 'She said she was busy, so a short, concrete slot is easy to agree to.',
    },
  ],
  summary: 'Sam asked for thirty seconds, respected her meeting and closed on a specific slot.',
  lessons: ['Ask for thirty seconds first.', 'Turn "I\'m busy" into a specific slot.'],
};

/** A reverse call: the rep played Claire, and Sam made the call and booked the meeting. */
export function reverseCallDetail(reviewPatch: Partial<CallReview> = {}): CallDetail {
  const base = callDetail(null);
  return {
    ...base,
    call: {
      ...base.call,
      mode: 'reverse',
      outcome: 'meeting_booked',
      overallScore: null,
      reviewStatus: reviewPatch.status ?? 'ready',
    },
    outcomeReason: 'Tuesday at 10am',
    turns: [
      turn(0, 'prospect', 'Claire Hughes.'),
      turn(1, 'rep', "Hi Claire, it's Sam from WattGuard. Have I caught you at a bad time?"),
      turn(2, 'prospect', "I'm about to go into a meeting"),
      turn(3, 'rep', "Then I'll be quick: would Tuesday at ten work for twenty minutes?"),
    ],
    review: {
      status: 'ready',
      result: null,
      notes: repNotes,
      error: null,
      model: 'claude-opus-5-5',
      costUsd: 0.031,
      updatedAt: '2026-09-30T10:02:00.000Z',
      ...reviewPatch,
    },
    cost: {
      totalUsd: 0.1283,
      lines: [
        { key: 'rep', model: 'claude-opus-5-5', quantity: 9_800, unit: 'tokens', usd: 0.0212 },
        { key: 'review', model: 'claude-opus-5-5', quantity: null, unit: 'tokens', usd: 0.031 },
        { key: 'stt', model: 'nova-3', quantity: 1.2, unit: 'minutes', usd: 0.0092 },
        { key: 'tts', model: 'sonic-3', quantity: 1_340, unit: 'characters', usd: 0.067 },
      ],
      incomplete: false,
      warnAboveUsd: 2,
      overBudget: false,
    },
  };
}
