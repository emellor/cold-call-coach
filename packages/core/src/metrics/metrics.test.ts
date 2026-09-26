import { describe, expect, it } from 'vitest';
import {
  type MetricTurn,
  computeMetrics,
  countCoreFillers,
  countSoftFillers,
  isOpenQuestion,
  sentencesOf,
} from './metrics.ts';

const rep = (text: string, startMs: number, endMs: number, extra: Partial<MetricTurn> = {}) =>
  ({ speaker: 'rep', text, startMs, endMs, ...extra }) as const;
const her = (text: string, startMs: number, endMs: number, extra: Partial<MetricTurn> = {}) =>
  ({ speaker: 'prospect', text, startMs, endMs, ...extra }) as const;

describe('fillers', () => {
  it('counts the core fillers as words, including Deepgram spellings', () => {
    expect(countCoreFillers('Um, so, uh... erm, er, ah, UMM and uhh.')).toBe(7);
    expect(countCoreFillers('Umbrella, errand, ahead, number')).toBe(0);
  });

  it('counts soft fillers and phrases on word boundaries', () => {
    expect(
      countSoftFillers("You know, it's basically, like, sort of a kind of thing, I mean."),
    ).toBe(6);
    expect(countSoftFillers("I'd like to know. Literally. Likely unlikely.")).toBe(2);
  });
});

describe('questions', () => {
  it('splits sentences on the punctuation Deepgram adds', () => {
    expect(sentencesOf('Hi Claire. Got a minute? Great!')).toEqual([
      'Hi Claire.',
      'Got a minute?',
      'Great!',
    ]);
  });

  it.each([
    ['What does month end look like for you?', true],
    ['How are you tracking energy today?', true],
    ['Why did the board ask?', true],
    ['Tell me about the Leeds site?', true],
    ['Walk me through your current process?', true],
    ["So, what's driving that?", true],
    ['Okay, and how often does that happen?', true],
    ['Do you have thirty seconds?', false],
    ['Is energy a priority?', false],
    ['Whatever happened to the old system, is it gone?', false],
  ])('%s → open: %s', (sentence, open) => {
    expect(isOpenQuestion(sentence)).toBe(open);
  });
});

describe('computeMetrics', () => {
  const call: MetricTurn[] = [
    her('Claire Hughes.', 0, 1_000),
    rep("Hi Claire, it's Sam from WattGuard. Have you got thirty seconds?", 1_500, 6_000),
    her('Go on.', 6_500, 7_000),
    rep('Um, what does energy reporting look like for you today? How many sites?', 7_600, 12_600),
    her('Three sites, and look, I', 13_000, 14_000, { interrupted: true }),
    rep('Right, and is that, like, a spreadsheet?', 14_100, 16_100),
  ];

  it('measures talk ratio, pace, fillers and questions from the turns', () => {
    const m = computeMetrics(call, 20_000);
    expect(m).toMatchObject({
      durationSec: 20,
      repSpeechSec: 11.5,
      prospectSpeechSec: 2.5,
      talkRatio: 0.82,
      repWords: 31,
      repWpm: 162,
      coreFillers: 1,
      // "look like" counts too: soft fillers are noisy, which is why §8.1 reports them apart.
      softFillers: 2,
      fillersPerMin: 5.2,
      // Open: "what does…" (after the "Um,") and "How many sites?"; closed: the other two.
      questionsOpen: 2,
      questionsClosed: 2,
      interruptions: 1,
    });
  });

  it('times the first question within its turn', () => {
    // "…Have you got thirty seconds?" ends the turn, so it lands at the turn's end.
    expect(computeMetrics(call, 20_000).timeToFirstQuestionSec).toBe(6);
    const withWords = computeMetrics(
      [
        rep('Hi. Got a minute? Great.', 1_000, 5_000, {
          words: [
            { text: 'Hi.', startMs: 1_000, endMs: 1_300 },
            { text: 'Got', startMs: 1_500, endMs: 1_700 },
            { text: 'a', startMs: 1_700, endMs: 1_800 },
            { text: 'minute?', startMs: 1_800, endMs: 2_200 },
            { text: 'Great.', startMs: 4_600, endMs: 5_000 },
          ],
        }),
      ],
      6_000,
    );
    expect(withWords.timeToFirstQuestionSec).toBe(2.2);
    expect(
      computeMetrics([rep('No questions here.', 0, 1_000)], 1_000).timeToFirstQuestionSec,
    ).toBeNull();
  });

  it('merges rep speech across short gaps into one monologue, but not across her voice', () => {
    const rambling: MetricTurn[] = [
      rep('First part', 0, 20_000),
      rep('second part', 21_000, 40_000), // 1 s gap: same monologue
      rep('third part', 42_000, 50_000), // 2 s gap: a new one
      her('Hmm.', 50_500, 51_000),
      rep('after her', 51_200, 60_000), // under 1.5 s, but she spoke in between
    ];
    expect(computeMetrics(rambling, 60_000).longestMonologueSec).toBe(40);
  });

  it('splits a turn at long pauses when it has word timings', () => {
    const words = [
      { text: 'one', startMs: 0, endMs: 10_000 },
      { text: 'two', startMs: 10_500, endMs: 20_000 },
      { text: 'three', startMs: 23_000, endMs: 30_000 }, // a 3 s pause inside the turn
    ];
    expect(
      computeMetrics([rep('one two three', 0, 30_000, { words })], 30_000).longestMonologueSec,
    ).toBe(20);
  });

  it('reports nulls, not zeros, for rates with nothing to divide by', () => {
    const m = computeMetrics([her('Hello?', 0, 800)], 5_000);
    expect(m).toMatchObject({
      talkRatio: 0,
      repWpm: null,
      fillersPerMin: null,
      timeToFirstQuestionSec: null,
      longestMonologueSec: 0,
    });
    expect(computeMetrics([], 0).talkRatio).toBeNull();
  });
});
