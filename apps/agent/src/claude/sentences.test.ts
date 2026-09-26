// M6: Claude's reply reaches TTS sentence by sentence, not as one block at the
// end. The prospect's text stream is fed into the sentence tokenizer the
// Cartesia plugin uses (LiveKit's basic SentenceTokenizer, minSentenceLength 8,
// in @livekit/agents-plugin-cartesia's SynthesizeStream), and the first
// sentence must come out while Claude is still writing the second. The
// tokenizer releases a sentence once about 10 characters of the next one have
// arrived (its streamContextLength), which is how it knows the sentence ended.
import type {
  BetaMessage,
  BetaRawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { tokenize } from '@livekit/agents';
import { describe, expect, it } from 'vitest';
import { type StreamingMessages, claudeTextStream } from './textStream.ts';

const delta = (text: string) =>
  ({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text },
  }) as BetaRawMessageStreamEvent;

describe('Claude to TTS', () => {
  it('hands TTS her first sentence while Claude is still writing the rest', async () => {
    let releaseRest = () => {};
    const restWritten = new Promise<void>((resolve) => {
      releaseRest = resolve;
    });
    const claude: StreamingMessages = {
      stream: () => ({
        async *[Symbol.asyncIterator]() {
          yield delta('Look, ');
          yield delta("I've got a board meeting in ten minutes. ");
          yield delta('What is it you');
          await restWritten; // Claude is still writing the rest
          yield delta(' actually want?');
        },
        finalMessage: () =>
          Promise.resolve({
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          } as BetaMessage),
      }),
    };
    const text = claudeTextStream({
      messages: claude,
      params: { model: 'claude-opus-5', max_tokens: 64, messages: [] },
    });
    const sentences = new tokenize.basic.SentenceTokenizer({ minSentenceLength: 8 }).stream();
    const spoken: string[] = [];
    const reading = (async () => {
      for await (const event of sentences) spoken.push(event.token);
    })();

    // Feed Claude's text in as it arrives, as LiveKit's TTS node does.
    const feeding = (async () => {
      for await (const chunk of text) sentences.pushText(chunk);
      sentences.endInput();
      sentences.close();
    })();

    await expect.poll(() => spoken).toEqual(["Look, I've got a board meeting in ten minutes."]);
    releaseRest();
    await feeding;
    await reading;
    expect(spoken).toEqual([
      "Look, I've got a board meeting in ten minutes.",
      'What is it you actually want?',
    ]);
  });
});
