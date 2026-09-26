import { ReadableStream } from 'node:stream/web';
import type {
  BetaMessage,
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';

/** What she says when Claude declines (the whole fallback chain refused) or errors. */
export const NEUTRAL_LINE = "Sorry, you're breaking up. Say that again?";

/** The slice of `client.beta.messages` this module uses; a fake satisfies it in tests. */
export interface StreamingMessages {
  stream(
    params: BetaMessageStreamParams,
    options?: { signal?: AbortSignal },
  ): AsyncIterable<BetaRawMessageStreamEvent> & { finalMessage(): Promise<BetaMessage> };
}

export interface ClaudeTextStreamOptions {
  messages: StreamingMessages;
  params: BetaMessageStreamParams;
  /** The finished message: usage, stop reason, content blocks. Not called if cancelled. */
  onComplete?: (message: BetaMessage) => void;
  /** Claude declined; the neutral line has been queued in its place. */
  onRefusal?: (message: BetaMessage) => void;
  /** The request failed; the neutral line has been queued so the call isn't silent. */
  onError?: (error: unknown) => void;
}

/**
 * Streams Claude's text deltas as a `ReadableStream<string>`, the shape LiveKit's
 * `llmNode` returns. LiveKit cancels the stream when the rep barges in; that
 * aborts the HTTP request so no further tokens are generated or billed.
 */
export function claudeTextStream(options: ClaudeTextStreamOptions): ReadableStream<string> {
  const abort = new AbortController();
  let cancelled = false;

  return new ReadableStream<string>({
    start(controller) {
      let spoke = false;
      const say = (text: string) => {
        if (cancelled) return;
        controller.enqueue(text);
        spoke = true;
      };
      const sayNeutralLine = () => say(spoke ? ` ${NEUTRAL_LINE}` : NEUTRAL_LINE);

      const run = async () => {
        const stream = options.messages.stream(options.params, { signal: abort.signal });
        for await (const event of stream) {
          if (cancelled) return;
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            if (event.delta.text) say(event.delta.text);
          }
        }
        const message = await stream.finalMessage();
        if (cancelled) return;
        if (message.stop_reason === 'refusal') {
          options.onRefusal?.(message);
          sayNeutralLine();
        }
        options.onComplete?.(message);
        controller.close();
      };

      run().catch((error: unknown) => {
        if (cancelled) return; // our own abort after a barge-in
        options.onError?.(error);
        sayNeutralLine();
        controller.close();
      });
    },
    cancel() {
      cancelled = true;
      abort.abort();
    },
  });
}
