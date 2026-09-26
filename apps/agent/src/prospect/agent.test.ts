import type {
  BetaMessage,
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { initializeLogger, llm, log } from '@livekit/agents';
import { describe, expect, it } from 'vitest';
import type { StreamingMessages } from '../claude/textStream.ts';
import { ProspectAgent } from './agent.ts';
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
      { role: 'assistant', content: 'Claire Hughes.' },
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
