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
  /** The finished message: usage, stop reason, content blocks. Called first; not if cancelled. */
  onComplete?: (message: BetaMessage) => void;
  /** Claude declined; the neutral line has been queued in its place. */
  onRefusal?: (message: BetaMessage) => void;
  /** The request failed; the neutral line has been queued so the call isn't silent. */
  onError?: (error: unknown) => void;
  /**
   * Called after onComplete (not after a refusal) with whether any text was
   * spoken; text it returns is spoken last. Lets a reply that was only a tool
   * call still say something, so LiveKit commits it.
   */
  closingText?: (message: BetaMessage, spoke: boolean) => string | undefined;
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
        options.onComplete?.(message);
        if (message.stop_reason === 'refusal') {
          options.onRefusal?.(message);
          sayNeutralLine();
        } else {
          const closing = options.closingText?.(message, spoke);
          if (closing) say(spoke ? ` ${closing}` : closing);
        }
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
