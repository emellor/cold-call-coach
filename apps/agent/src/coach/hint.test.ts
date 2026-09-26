import { APIError, APIUserAbortError } from '@anthropic-ai/sdk';
import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { describe, expect, it, vi } from 'vitest';
import type { ParsingMessages } from '../judge/judge.ts';
import { silentLogger } from '../test/fixtures.ts';
import { HintError, claudeHints, describeHintError } from './hint.ts';

const usage = { input_tokens: 600, output_tokens: 60, cache_read_input_tokens: 400 };
const reply = (parsed_output: unknown, patch: Partial<BetaMessage> = {}) =>
  ({
    model: 'claude-opus-5',
    stop_reason: 'end_turn',
    usage,
    content: [],
    parsed_output,
    ...patch,
  }) as BetaMessage & { parsed_output: unknown };

function hintsFrom(answer: () => Promise<BetaMessage & { parsed_output: unknown }>) {
  const parse = vi.fn<ParsingMessages['parse']>(() => answer());
  const onUsage = vi.fn();
  const hints = claudeHints({
    messages: { parse },
    model: 'claude-opus-5',
    effort: 'low',
    logger: silentLogger,
    onUsage,
  });
  return { hints, parse, onUsage };
}

const prompt = { system: 'You coach.', user: 'Prospect: Claire Hughes.' };

describe('claudeHints', () => {
  it('asks for structured lines and returns them cleaned, with how long it took', async () => {
    const { hints, parse, onUsage } = hintsFrom(() =>
      Promise.resolve(
        reply({
          suggestions: [' "Got thirty seconds?" ', 'Got thirty seconds?', 'Is now bad?', 'Hi.'],
        }),
      ),
    );
    const result = await hints(prompt);
    expect(result.suggestions).toEqual(['Got thirty seconds?', 'Is now bad?', 'Hi.']);
    expect(result.ms).toBeGreaterThanOrEqual(0);
    const [params, options] = parse.mock.calls[0]!;
    expect(params).toMatchObject({
      model: 'claude-opus-5',
      messages: [{ role: 'user', content: 'Prospect: Claire Hughes.' }],
      output_config: { effort: 'low', format: { type: 'json_schema' } },
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(onUsage).toHaveBeenCalledWith(
      'claude-opus-5',
      expect.objectContaining({ outputTokens: 60 }),
    );
  });

  it('fails on a refusal or an empty answer', async () => {
    const refused = hintsFrom(() => Promise.resolve(reply(null, { stop_reason: 'refusal' })));
    await expect(refused.hints(prompt)).rejects.toThrow(HintError);
    const empty = hintsFrom(() => Promise.resolve(reply({ suggestions: ['  ', ''] })));
    await expect(empty.hints(prompt)).rejects.toThrow('The hint came back empty. Try again.');
  });
});

describe('describeHintError', () => {
  const apiError = (status: number) =>
    APIError.generate(status, { error: { type: 'x', message: 'raw' } }, 'raw', new Headers());

  it('turns failures into something the rep can act on', () => {
    expect(describeHintError(apiError(401))).toContain('check ANTHROPIC_API_KEY');
    expect(describeHintError(apiError(429))).toContain('rate-limiting');
    expect(describeHintError(apiError(529))).toContain('overloaded');
    expect(describeHintError(new APIUserAbortError())).toBe('The hint took too long. Try again.');
    expect(describeHintError(new DOMException('timed out', 'TimeoutError'))).toBe(
      'The hint took too long. Try again.',
    );
    expect(describeHintError(new HintError('Nothing here.'))).toBe('Nothing here.');
    expect(describeHintError(new Error('raw internals'))).toBe("Couldn't get a hint. Try again.");
  });
});
