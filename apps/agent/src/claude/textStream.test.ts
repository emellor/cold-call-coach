import type { ReadableStream } from 'node:stream/web';
import type {
  BetaMessage,
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { describe, expect, it, vi } from 'vitest';
import { NEUTRAL_LINE, type StreamingMessages, claudeTextStream } from './textStream.ts';

const params = { model: 'claude-opus-5', max_tokens: 300, messages: [] } as BetaMessageStreamParams;

const text = (t: string) =>
  ({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: t },
  }) as BetaRawMessageStreamEvent;
const thinking = () =>
  ({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'thinking_delta', thinking: '' },
  }) as BetaRawMessageStreamEvent;
const message = (stop_reason: BetaMessage['stop_reason']) =>
  ({ stop_reason, usage: { input_tokens: 10, output_tokens: 5 } }) as BetaMessage;

interface Script {
  events: BetaRawMessageStreamEvent[];
  final?: BetaMessage;
  failWith?: Error;
  /** Hang after the events until aborted, like a slow model mid-reply. */
  hang?: boolean;
}

function fakeClaude(script: Script) {
  const signals: (AbortSignal | undefined)[] = [];
  const messages: StreamingMessages = {
    stream(_params, options) {
      signals.push(options?.signal);
      return {
        async *[Symbol.asyncIterator]() {
          for (const event of script.events) yield event;
          if (script.failWith) throw script.failWith;
          if (script.hang) {
            await new Promise((_, reject) =>
              options?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
            );
          }
        },
        finalMessage: () => Promise.resolve(script.final ?? message('end_turn')),
      };
    },
  };
  return { messages, signals };
}

async function readAll(stream: ReadableStream<string>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe('claudeTextStream', () => {
  it('streams text deltas in order, skipping thinking, then reports the final message', async () => {
    const final = message('end_turn');
    const { messages } = fakeClaude({
      events: [thinking(), text('Right. '), text('Go on.')],
      final,
    });
    const onComplete = vi.fn();
    const chunks = await readAll(claudeTextStream({ messages, params, onComplete }));
    expect(chunks).toEqual(['Right. ', 'Go on.']);
    expect(onComplete).toHaveBeenCalledWith(final);
  });

  it('speaks the neutral line when Claude declines before saying anything', async () => {
    const { messages } = fakeClaude({ events: [], final: message('refusal') });
    const onRefusal = vi.fn();
    expect(await readAll(claudeTextStream({ messages, params, onRefusal }))).toEqual([
      NEUTRAL_LINE,
    ]);
    expect(onRefusal).toHaveBeenCalledOnce();
  });

  it('appends the neutral line after a partial reply that was then refused', async () => {
    const { messages } = fakeClaude({ events: [text('Well,')], final: message('refusal') });
    expect((await readAll(claudeTextStream({ messages, params }))).join('')).toBe(
      `Well, ${NEUTRAL_LINE}`,
    );
  });

  it('speaks the neutral line instead of going silent when the request fails', async () => {
    const failure = new Error('overloaded');
    const { messages } = fakeClaude({ events: [], failWith: failure });
    const onError = vi.fn();
    expect(await readAll(claudeTextStream({ messages, params, onError }))).toEqual([NEUTRAL_LINE]);
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('aborts the Claude request when LiveKit cancels the node on a barge-in', async () => {
    const { messages, signals } = fakeClaude({ events: [text('Look, I')], hang: true });
    const onComplete = vi.fn();
    const onError = vi.fn();
    const stream = claudeTextStream({ messages, params, onComplete, onError });
    const reader = stream.getReader();
    expect((await reader.read()).value).toBe('Look, I');

    await reader.cancel();
    await new Promise((resolve) => setImmediate(resolve));

    expect(signals[0]?.aborted).toBe(true);
    expect(onComplete).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
