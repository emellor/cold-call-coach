import { APIError } from '@anthropic-ai/sdk';
import type {
  BetaRawMessageStreamEvent,
  MessageCreateParamsStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { ScenarioSpec } from '@ccc/contracts';
import { describe, expect, it } from 'vitest';
import { testCatalog } from '../test/catalog.ts';
import { sampleDraft } from '../test/callLog.ts';
import {
  REVIEW_MAX_TOKENS,
  ReviewError,
  type StreamingMessages,
  claudeReviewer,
  describeClaudeError,
  reviewRequest,
} from './reviewer.ts';

const scenario = ScenarioSpec.parse(
  testCatalog.scenarios.find((s) => s.id === 'medium-finance-director'),
);
const input = {
  rubric: testCatalog.rubrics[0]!,
  scenario,
  product: testCatalog.product,
  metrics: {
    durationSec: 90,
    repSpeechSec: 30,
    prospectSpeechSec: 10,
    talkRatio: 0.75,
    repWords: 80,
    repWpm: 160,
    coreFillers: 1,
    softFillers: 0,
    fillersPerMin: 2,
    questionsOpen: 0,
    questionsClosed: 1,
    longestMonologueSec: 8,
    interruptions: 0,
    timeToFirstQuestionSec: 14,
  },
  outcome: 'hung_up_by_prospect' as const,
  outcomeReason: 'Out of patience',
  turns: [{ speaker: 'rep' as const, text: 'Hello', startMs: 0, interrupted: false }],
};

/** A streamed answer: the model's text in two deltas, then the stop reason. */
function fakeStream(answer: { text?: string; stopReason?: string; model?: string }) {
  const sent: MessageCreateParamsStreaming[] = [];
  const text = answer.text ?? '';
  const events = [
    {
      type: 'message_start',
      message: {
        model: answer.model ?? 'claude-opus-5',
        usage: { input_tokens: 4_000, output_tokens: 1, cache_read_input_tokens: 0 },
      },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: text.slice(0, 10) },
    },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(10) } },
    {
      type: 'message_delta',
      delta: { stop_reason: answer.stopReason ?? 'end_turn' },
      usage: { output_tokens: 1_000 },
    },
    { type: 'message_stop' },
  ] as unknown as BetaRawMessageStreamEvent[];
  const messages: StreamingMessages = {
    create: (params) => {
      sent.push(params);
      return Promise.resolve(
        (async function* () {
          for (const event of events) yield await Promise.resolve(event);
        })(),
      );
    },
  };
  return { messages, sent };
}

describe('reviewRequest', () => {
  it('asks Opus 5 at the review effort for ReviewDraft, with the rubric cached in system', () => {
    const request = reviewRequest({ model: 'claude-opus-5', effort: 'high', input });
    expect(request).toMatchObject({
      model: 'claude-opus-5',
      max_tokens: REVIEW_MAX_TOKENS,
      output_config: { effort: 'high', format: { type: 'json_schema' } },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    const system = request.system as Array<{ text: string; cache_control?: unknown }>;
    expect(system[0]?.text).toContain('Rubric "B2B cold call"');
    expect(system[0]?.cache_control).toEqual({ type: 'ephemeral' });
    expect(JSON.stringify(request.messages)).toContain('[1] Rep (0:00): Hello');
    for (const key of ['temperature', 'top_p', 'top_k']) expect(request).not.toHaveProperty(key);
  });

  it('keeps the rubric keys as an enum in the schema, and sends no effort to Haiku', () => {
    const request = reviewRequest({ model: 'claude-haiku-4-5', effort: 'high', input });
    const format = (request.output_config as { format: { schema: unknown } }).format;
    expect(JSON.stringify(format.schema)).toContain(
      '"enum":["opener","reason","discovery","objections","next_step","delivery"]',
    );
    expect(request.output_config).not.toHaveProperty('effort');
    expect(request).not.toHaveProperty('fallbacks');
  });
});

describe('claudeReviewer', () => {
  const reviewer = (answer: Parameters<typeof fakeStream>[0]) =>
    claudeReviewer({ ...fakeStream(answer), model: 'claude-opus-5', effort: 'high' });

  it('streams the review, then returns the parsed draft, the answering model and its cost', async () => {
    const { messages, sent } = fakeStream({ text: JSON.stringify(sampleDraft) });
    const outcome = await claudeReviewer({ messages, model: 'claude-opus-5', effort: 'high' })(
      input,
    );
    expect(sent[0]?.stream).toBe(true);
    expect(outcome.draft).toEqual(sampleDraft);
    expect(outcome.model).toBe('claude-opus-5');
    expect(outcome.costUsd).toBe(0.045); // 4,000 in at $5 + 1,000 out at $25, per million
  });

  it('prices the model that actually answered', async () => {
    const outcome = await reviewer({ text: JSON.stringify(sampleDraft), model: 'claude-opus-5-5' })(
      input,
    );
    expect(outcome.model).toBe('claude-opus-5-5');
    expect(outcome.costUsd).toBe(0.036); // $4 in, $20 out
  });

  it.each([
    [{ stopReason: 'refusal', text: '{"outc' }, 'Claude declined to review this call.'],
    [{ stopReason: 'max_tokens', text: '{"outcome": "cut o' }, 'ran out of room'],
    [{ text: '{"outcome": 3}' }, 'came back malformed'],
  ])('fails with a message the rep can read: %o', async (answer, error) => {
    await expect(reviewer(answer)(input)).rejects.toThrow(error);
    await expect(reviewer(answer)(input)).rejects.toBeInstanceOf(ReviewError);
  });
});

describe('describeClaudeError', () => {
  const apiError = (status: number | undefined) =>
    APIError.generate(status, { error: { type: 'x', message: 'raw' } }, 'raw', new Headers());

  it('turns API failures into something the rep can act on', () => {
    expect(describeClaudeError(apiError(401))).toContain('check ANTHROPIC_API_KEY');
    expect(describeClaudeError(apiError(429))).toContain('rate-limiting');
    expect(describeClaudeError(apiError(529))).toContain('overloaded');
    expect(describeClaudeError(apiError(400))).toMatch(/^Claude answered 400/);
    expect(describeClaudeError(new Error('socket hang up'))).toBe('socket hang up');
  });

  it('is what a failed review reports', async () => {
    const messages: StreamingMessages = { create: () => Promise.reject(apiError(401)) };
    const reviewer = claudeReviewer({ messages, model: 'claude-opus-5', effort: 'high' });
    await expect(reviewer(input)).rejects.toThrow('check ANTHROPIC_API_KEY');
  });
});
