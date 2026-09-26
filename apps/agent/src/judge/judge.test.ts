import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { describe, expect, it, vi } from 'vitest';
import { judged, silentLogger } from '../test/fixtures.ts';
import { type ParsingMessages, claudeJudge } from './judge.ts';

const usage = { input_tokens: 900, output_tokens: 80, cache_read_input_tokens: 700 };
const reply = (patch: Partial<BetaMessage> & { parsed_output: unknown }) =>
  ({
    model: 'claude-opus-5',
    stop_reason: 'end_turn',
    usage,
    content: [],
    ...patch,
  }) as BetaMessage & {
    parsed_output: unknown;
  };

function fakeParse(result: () => Promise<BetaMessage & { parsed_output: unknown }>) {
  const parse = vi.fn<ParsingMessages['parse']>(() => result());
  return { messages: { parse } satisfies ParsingMessages, parse };
}

const prompt = { system: 'You judge.', user: 'LATEST Rep: hello' };

describe('claudeJudge', () => {
  it('returns the parsed judgement from a structured-output request', async () => {
    const result = judged({ askedPermission: true });
    const { messages, parse } = fakeParse(() => Promise.resolve(reply({ parsed_output: result })));
    const judge = claudeJudge({
      messages,
      model: 'claude-opus-5',
      effort: 'low',
      logger: silentLogger,
    });

    await expect(judge(prompt)).resolves.toEqual(result);
    const [params, options] = parse.mock.calls[0]!;
    expect(params).toMatchObject({
      model: 'claude-opus-5',
      messages: [{ role: 'user', content: 'LATEST Rep: hello' }],
      output_config: { effort: 'low', format: { type: 'json_schema' } },
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns null when Claude declines', async () => {
    const { messages } = fakeParse(() =>
      Promise.resolve(reply({ stop_reason: 'refusal', parsed_output: null })),
    );
    const warn = vi.fn();
    const judge = claudeJudge({
      messages,
      model: 'claude-opus-5',
      effort: 'low',
      logger: { ...silentLogger, warn },
    });
    await expect(judge(prompt)).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('returns null when the request fails or the output does not parse', async () => {
    const { messages } = fakeParse(() =>
      Promise.reject(new Error('Failed to parse structured output')),
    );
    const judge = claudeJudge({
      messages,
      model: 'claude-opus-5',
      effort: 'low',
      logger: silentLogger,
    });
    await expect(judge(prompt)).resolves.toBeNull();
  });

  it('gives up when the call outlives its timeout', async () => {
    const messages: ParsingMessages = {
      parse: (_params, options) =>
        new Promise((_, reject) =>
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    };
    const judge = claudeJudge({
      messages,
      model: 'claude-opus-5',
      effort: 'low',
      logger: silentLogger,
      timeoutMs: 20,
    });
    await expect(judge(prompt)).resolves.toBeNull();
  });
});
