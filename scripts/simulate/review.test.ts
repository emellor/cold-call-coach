import { readFileSync } from 'node:fs';
import { ProductSpec, RubricSpec, ScenarioSpec } from '@ccc/contracts';
import { describe, expect, it } from 'vitest';
import type { BetaRawMessageStreamEvent } from '../../apps/agent/src/claude/client.ts';
import type { StreamingMessages } from '../../apps/api/src/review/reviewer.ts';
import type { SimResult } from './harness.ts';
import { reviewSimulatedCall, timedTurns } from './review.ts';

const load = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../scenarios/${path}`, import.meta.url), 'utf8'));
const scenario = ScenarioSpec.parse(load('medium-finance-director.json'));
const product = ProductSpec.parse(load('product.json'));
const rubric = RubricSpec.parse(load('rubrics/cold-call-v1.json'));

const result: SimResult = {
  outcome: 'hung_up_by_prospect',
  detail: 'Waste of time',
  turns: [
    {
      turn: 1,
      rep: 'Hi Claire, it is Sam from WattGuard.',
      prospect: 'Go on.',
      actions: [],
      judged: undefined,
    },
    { turn: 2, rep: 'We do dashboards.', prospect: 'Goodbye.', actions: [], judged: undefined },
  ],
  final: { turn: 2, interest: 20, patience: 0, painsRevealed: [] },
  usage: { calls: 6, inputTokens: 0, cacheReadInputTokens: 0, outputTokens: 0 },
};

describe('timedTurns', () => {
  it('lays the call out in time, opening line first, 0.6 s between turns', () => {
    const turns = timedTurns(result, 'Claire Hughes.');
    expect(turns.map((t) => [t.speaker, t.text])).toEqual([
      ['prospect', 'Claire Hughes.'],
      ['rep', 'Hi Claire, it is Sam from WattGuard.'],
      ['prospect', 'Go on.'],
      ['rep', 'We do dashboards.'],
      ['prospect', 'Goodbye.'],
    ]);
    // The opening line takes 741 ms (2 words at 2.7 a second), then a 0.6 s gap; the rep's 7 words take 2.8 s.
    expect(turns[1]).toMatchObject({ startMs: 1_341, endMs: 4_141 });
  });
});

describe('reviewSimulatedCall', () => {
  it('runs the API’s reviewer and validates its quotes against the simulated transcript', async () => {
    const draft = {
      outcome: 'She hung up.',
      overallScore: 20,
      summary: 'Too much product, too soon.',
      stages: rubric.criteria.map((c) => ({
        key: c.key,
        score: 2,
        evidence: c.key === 'reason' ? [{ turn: 4, quote: 'We do dashboards' }] : [],
        feedback: 'x',
      })),
      topMoments: [{ turn: 4, youSaid: 'We sell the best dashboards', tryInstead: 'y', why: 'z' }],
      objections: [],
      strengths: [],
      drill: { title: 't', instructions: 'i' },
    };
    let sentUser = '';
    const events = [
      {
        type: 'message_start',
        message: { model: 'claude-opus-5', usage: { input_tokens: 1_000, output_tokens: 1 } },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: JSON.stringify(draft) },
      },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 1_000 },
      },
    ] as unknown as BetaRawMessageStreamEvent[];
    const messages: StreamingMessages = {
      create: (params) => {
        const first = params.messages[0]?.content;
        sentUser = typeof first === 'string' ? first : '';
        return Promise.resolve(
          (async function* () {
            for (const event of events) yield await Promise.resolve(event);
          })(),
        );
      },
    };
    const reviewed = await reviewSimulatedCall({
      messages: messages,
      model: 'claude-opus-5',
      effort: 'high',
      scenario,
      product,
      rubric,
      result,
    });
    expect(sentUser).toContain('How the call ended: she hung up (Waste of time).');
    expect(sentUser).toContain('[4] Rep (0:06): We do dashboards.');
    expect(reviewed.review.stages.find((s) => s.key === 'reason')?.evidence).toEqual([
      { turn: 4, quote: 'We do dashboards' },
    ]);
    expect(reviewed.review.topMoments).toEqual([]);
    expect(reviewed.dropped).toHaveLength(1);
    expect(reviewed.costUsd).toBe(0.03);
  });
});
