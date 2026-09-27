import type {
  BetaMessage,
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { ReadableStream } from 'node:stream/web';
import { initializeLogger, llm, log, stt, voice } from '@livekit/agents';
import { describe, expect, it, vi } from 'vitest';
import type { StreamingMessages } from '../claude/textStream.ts';
import { ProspectAgent, tapFinalWords } from './agent.ts';
import { REPLY_ID_KEY, ReplyLedger } from './replies.ts';

initializeLogger({ pretty: false, level: 'silent' });

const NOTE = 'Private note for your next reply (never mention it):\nPatience: some.';

const textDelta = (text: string) =>
  ({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text },
  }) as BetaRawMessageStreamEvent;

function fakeClaude(events: BetaRawMessageStreamEvent[], final: Partial<BetaMessage>) {
  const sent: BetaMessageStreamParams[] = [];
  const claude: StreamingMessages = {
    stream(params) {
      sent.push(params);
      return {
        async *[Symbol.asyncIterator]() {
          for (const event of events) yield await Promise.resolve(event);
        },
        finalMessage: () =>
          Promise.resolve({
            model: params.model,
            stop_reason: 'end_turn',
            content: [],
            usage: { input_tokens: 1, output_tokens: 1 },
            ...final,
          } as BetaMessage),
      };
    },
  };
  return { claude, sent };
}

async function reply(options: {
  model: string;
  events?: BetaRawMessageStreamEvent[];
  final?: Partial<BetaMessage>;
  hangUpDue?: boolean;
  onUsage?: (model: string, usage: unknown) => void;
}) {
  const { claude, sent } = fakeClaude(options.events ?? [textDelta('Go on.')], options.final ?? {});
  const ledger = new ReplyLedger();
  const agent = new ProspectAgent({
    persona: 'You are Claire Hughes.',
    claude,
    model: options.model,
    effort: 'low',
    brain: { note: () => NOTE, hangUpDue: options.hangUpDue ?? false },
    ledger,
    logger: log(),
    onUsage: options.onUsage,
  });
  const chatCtx = llm.ChatContext.empty();
  chatCtx.addMessage({ role: 'assistant', content: 'Claire Hughes.' });
  chatCtx.addMessage({ role: 'user', content: "Hi Claire, it's Sam. Got thirty seconds?" });
  const stream = await agent.llmNode(chatCtx, {} as llm.ToolContext, {});
  const chunks: Array<llm.ChatChunk | string> = [];
  for await (const chunk of stream) chunks.push(chunk);
  const marker = chunks[0] as llm.ChatChunk;
  const replyId = marker.delta?.extra?.[REPLY_ID_KEY];
  return { sent, chunks, replyId, ledger };
}

describe('ProspectAgent.llmNode', () => {
  it('Opus 5: the state note is a final system message, with effort', async () => {
    const { sent } = await reply({ model: 'claude-opus-5' });
    const request = sent[0]!;
    expect(request.messages).toEqual([
      { role: 'user', content: '(Your phone rings and you answer.)' },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Claire Hughes.', cache_control: { type: 'ephemeral' } }],
      },
      { role: 'user', content: "Hi Claire, it's Sam. Got thirty seconds?" },
      { role: 'system', content: NOTE },
    ]);
    expect(request.output_config).toEqual({ effort: 'low' });
    expect(request.tools?.length).toBe(2);
  });

  it('Haiku 4.5: the note rides on the last user turn, and no effort is sent', async () => {
    const { sent } = await reply({ model: 'claude-haiku-4-5' });
    const request = sent[0]!;
    expect(request.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(request.messages.at(-1)?.content).toBe(
      `Hi Claire, it's Sam. Got thirty seconds?\n\n<private_note>\n${NOTE}\n</private_note>`,
    );
    expect(request).not.toHaveProperty('output_config');
  });

  it('tags the reply so its tool calls can wait until it has been heard', async () => {
    const { chunks, replyId, ledger } = await reply({
      model: 'claude-opus-5',
      events: [textDelta('Fine, Tuesday at ten.')],
      final: {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'agree_to_meeting',
            input: { when: 'Tuesday at 10am' },
          },
        ],
      },
    });
    expect(chunks.slice(1)).toEqual(['Fine, Tuesday at ten.']);
    expect(typeof replyId).toBe('string');
    expect(ledger.committed(replyId)).toMatchObject({
      forcedGoodbye: false,
      actions: [{ type: 'agree_to_meeting', when: 'Tuesday at 10am' }],
    });
  });

  it('says goodbye out loud when she hangs up without a word', async () => {
    const { chunks, replyId, ledger } = await reply({
      model: 'claude-opus-5',
      events: [],
      final: {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_2',
            name: 'end_call',
            input: { reason: 'Wasting my time' },
          },
        ],
      },
      hangUpDue: true,
    });
    expect(chunks.slice(1)).toEqual(['Right. Goodbye.']);
    expect(ledger.committed(replyId)).toMatchObject({
      forcedGoodbye: true,
      actions: [{ type: 'end_call', reason: 'Wasting my time' }],
    });
  });
});

describe('the call log hooks', () => {
  it('reports each finished reply’s usage', async () => {
    const onUsage = vi.fn();
    await reply({ model: 'claude-opus-5', onUsage });
    expect(onUsage).toHaveBeenCalledWith('claude-opus-5', {
      inputTokens: 1,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 1,
    });
  });

  it('copies final transcripts’ word timings aside and passes every event on', async () => {
    const word = (text: string, startTime: number, endTime: number) =>
      ({ text, startTime, endTime }) as never;
    const events: stt.SpeechEvent[] = [
      {
        type: stt.SpeechEventType.INTERIM_TRANSCRIPT,
        alternatives: [{ text: 'Hi', words: [word('Hi', 1, 1.2)] } as never],
      },
      {
        type: stt.SpeechEventType.FINAL_TRANSCRIPT,
        alternatives: [
          { text: 'Hi Claire', words: [word('Hi', 1, 1.2), word('Claire', 1.3, 1.7)] } as never,
        ],
      },
      { type: stt.SpeechEventType.END_OF_SPEECH },
    ];
    const onFinal = vi.fn();
    const tapped = tapFinalWords(
      new ReadableStream<stt.SpeechEvent | string>({
        start(controller) {
          for (const event of events) controller.enqueue(event);
          controller.close();
        },
      }),
      onFinal,
    );
    const seen: Array<stt.SpeechEvent | string> = [];
    for await (const event of tapped) seen.push(event);
    expect(seen).toEqual(events);
    expect(onFinal.mock.calls).toEqual([
      [
        [
          { text: 'Hi', startTime: 1, endTime: 1.2 },
          { text: 'Claire', startTime: 1.3, endTime: 1.7 },
        ],
      ],
    ]);
  });
});

describe('pause', () => {
  it('drops a turn that completes while the rep has the call paused', async () => {
    let paused = false;
    const agent = new ProspectAgent({
      persona: 'You are Claire Hughes.',
      claude: fakeClaude([], {}).claude,
      model: 'claude-opus-5',
      effort: 'low',
      brain: { note: () => NOTE, hangUpDue: false },
      ledger: new ReplyLedger(),
      logger: log(),
      paused: () => paused,
    });
    const message = llm.ChatMessage.create({ role: 'user', content: 'Um, so' });
    await expect(
      agent.onUserTurnCompleted(new llm.ChatContext(), message),
    ).resolves.toBeUndefined();
    paused = true;
    await expect(async () =>
      agent.onUserTurnCompleted(new llm.ChatContext(), message),
    ).rejects.toBeInstanceOf(voice.StopResponse);
  });
});
