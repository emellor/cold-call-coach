import type { ReviewDraft } from '@ccc/contracts';
import { describe, expect, it } from 'vitest';
import {
  type QuoteTurn,
  finalizeReview,
  findQuote,
  normalizeForQuote,
  validateQuotes,
} from './validateQuotes.ts';

const turns: QuoteTurn[] = [
  { speaker: 'prospect', text: 'Claire Hughes.' },
  { speaker: 'rep', text: "Hi Claire, it's Sam from WattGuard — sorry to bother you!" },
  { speaker: 'prospect', text: "Right. What's this about?" },
  { speaker: 'rep', text: 'We do per-site energy dashboards, anomaly alerts, and ESOS reporting.' },
  { speaker: 'prospect', text: 'We already get reports from our supplier.' },
  { speaker: 'rep', text: 'OK, but ours are better. Can I send you some information?' },
];

describe('normalizeForQuote', () => {
  it('ignores case, punctuation, apostrophes and spacing', () => {
    expect(normalizeForQuote("  It's   Sam — from WattGuard!! ")).toBe('its sam from wattguard');
  });
});

describe('findQuote', () => {
  it('finds a quote in the cited turn regardless of case and punctuation', () => {
    expect(findQuote(turns, 'its sam from wattguard sorry to bother you', 2)).toBe(2);
  });

  it('moves a quote cited to the wrong turn to the one that has it', () => {
    expect(findQuote(turns, 'Can I send you some information?', 4)).toBe(6);
  });

  it('accepts fragments of one turn joined by an ellipsis, in order only', () => {
    expect(findQuote(turns, 'We do per-site energy dashboards … ESOS reporting', 4)).toBe(4);
    expect(findQuote(turns, 'ESOS reporting ... per-site energy', 4)).toBeNull();
  });

  it('rejects words the call never had, paraphrases, and partial words', () => {
    expect(findQuote(turns, 'Can I email you a brochure?', 6)).toBeNull();
    expect(findQuote(turns, 'our dashboards are better', 6)).toBeNull();
    expect(findQuote(turns, 'Hug', 1)).toBeNull();
    expect(findQuote(turns, ' ... ', 2)).toBeNull();
  });

  it('only matches the rep when the quote must be the rep’s', () => {
    expect(findQuote(turns, 'We already get reports from our supplier', 5, 'rep')).toBeNull();
    expect(findQuote(turns, 'We already get reports from our supplier', 5)).toBe(5);
  });
});

const draft: ReviewDraft = {
  outcome: 'She put you off with an email.',
  overallScore: 31.6,
  summary: 'You led with features instead of her problem.',
  stages: [
    {
      key: 'opener',
      score: 1.4,
      evidence: [
        { turn: 2, quote: 'sorry to bother you' },
        { turn: 2, quote: 'I promise this will be quick' }, // never said
      ],
      feedback: 'Drop the apology.',
    },
    {
      key: 'objections',
      score: 9,
      evidence: [{ turn: 7, quote: 'ours are better' }],
      feedback: 'x',
    },
    { key: 'opener', score: 5, evidence: [], feedback: 'duplicate' },
  ],
  topMoments: [
    { turn: 4, youSaid: 'We do per-site energy dashboards', tryInstead: 'a', why: 'b' },
    { turn: 6, youSaid: 'Our product is the best on the market', tryInstead: 'c', why: 'd' },
    { turn: 6, youSaid: 'Can I send you some information', tryInstead: 'e', why: 'f' },
    { turn: 2, youSaid: 'Hi Claire', tryInstead: 'g', why: 'h' },
  ],
  objections: [
    {
      turn: 5,
      objection: 'We already get reports from our supplier',
      yourResponse: 'OK, but ours are better.',
      score: 0,
      better: 'Fair enough; what do those reports not tell you?',
    },
    {
      turn: 5,
      objection: 'Supplier reports',
      yourResponse: 'We already get reports from our supplier', // her words, not the rep's
      score: 2,
      better: '…',
    },
  ],
  strengths: [' Clear name and company. ', '', 'Energy', 'Brevity', 'Four'],
  drill: { title: ' Permission openers ', instructions: 'Practise ten openers.' },
};

describe('validateQuotes', () => {
  it('drops every item whose quote is not in the transcript, and says which', () => {
    const { review, dropped } = validateQuotes(draft, turns);
    expect(review.stages[0]?.evidence).toEqual([{ turn: 2, quote: 'sorry to bother you' }]);
    expect(review.stages[1]?.evidence).toEqual([{ turn: 6, quote: 'ours are better' }]);
    expect(review.topMoments.map((m) => m.youSaid)).toEqual([
      'We do per-site energy dashboards',
      'Can I send you some information',
      'Hi Claire',
    ]);
    expect(review.objections).toHaveLength(1);
    expect(dropped).toEqual([
      { field: 'stages.opener.evidence', turn: 2, quote: 'I promise this will be quick' },
      { field: 'topMoments', turn: 6, quote: 'Our product is the best on the market' },
      { field: 'objections', turn: 5, quote: 'We already get reports from our supplier' },
    ]);
  });
});

describe('finalizeReview', () => {
  const criteria = [
    'opener',
    'reason',
    'discovery',
    'objections',
    'next_step',
    'delivery',
  ] as const;

  it('stores a clean ReviewResult: rounded, clamped, capped and in rubric order', () => {
    const { result, dropped } = finalizeReview(draft, turns, criteria);
    expect(result.overallScore).toBe(32);
    expect(result.stages.map((s) => [s.key, s.score])).toEqual([
      ['opener', 1],
      ['objections', 5],
    ]);
    expect(result.topMoments).toHaveLength(3);
    expect(result.objections[0]?.score).toBe(1);
    expect(result.strengths).toEqual(['Clear name and company.', 'Energy', 'Brevity']);
    expect(result.drill.title).toBe('Permission openers');
    expect(result.quotesDropped).toBe(dropped.length);
    expect(result.quotesDropped).toBe(3);
  });
});
