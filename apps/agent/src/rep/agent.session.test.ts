// Sam against LiveKit's real AgentSession, in its text-only mode (no room, no
// audio): the rep speaks first as the prospect, and Claude sees the call from
// Sam's side, her lines as the user and his as the assistant.
import type {
  BetaMessage,
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { initializeLogger, log, voice } from '@livekit/agents';
import { afterEach, describe, expect, it } from 'vitest';
import type { StreamingMessages } from '../claude/textStream.ts';
import { REPLY_ID_KEY, ReplyLedger } from '../prospect/replies.ts';
import { RepAgent } from './agent.ts';
import { REP_TOOLS, type RepAction } from './tools.ts';

initializeLogger({ pretty: false, level: 'silent' });

type Block = { type: 'text'; text: string } | Record<string, unknown>;

/** Claude as Sam: answers each request with the next reply's blocks. */
function scriptedClaude(replies: Block[][]) {
  const sent: BetaMessageStreamParams[] = [];
  const claude: StreamingMessages = {
    stream(params) {
      sent.push(params);
      const content = replies.shift() ?? [{ type: 'text', text: 'Right.' }];
      const text = content.flatMap((b) => (b.type === 'text' ? [b.text as string] : [])).join('');
      return {
        async *[Symbol.asyncIterator]() {
          if (!text) return;
          yield await Promise.resolve({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text },
          } as BetaRawMessageStreamEvent);
        },
        finalMessage: () =>
          Promise.resolve({
            model: params.model,
            stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
            content,
            usage: { input_tokens: 1, output_tokens: 1 },
          } as unknown as BetaMessage),
      };
    },
  };
  return { claude, sent };
}

const asLines = (params: BetaMessageStreamParams | undefined) =>
  (params?.messages ?? []).map((m) => {
    const text =
      typeof m.content === 'string'
        ? m.content
        : m.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
    return `${m.role}: ${text}`;
  });

describe('Sam, on a real LiveKit session', () => {
  let session: voice.AgentSession | undefined;
  afterEach(async () => {
    await session?.close();
    session = undefined;
  });

  const spokenLines = (agent: RepAgent) =>
    agent.chatCtx.items.flatMap((item) =>
      item.type === 'message' && item.role !== 'system'
        ? [`${item.role}: ${item.textContent}`]
        : [],
    );

  it('answers her greeting, and sees the call from his side with his own prompt and tools', async () => {
    const { claude, sent } = scriptedClaude([
      [
        {
          type: 'text',
          text: "Hi Rachel, it's Sam from WattGuard. Have I caught you at a bad time?",
        },
      ],
      [{ type: 'text', text: 'How do you report energy to clients today?' }],
    ]);
    const agent = new RepAgent({
      system: 'You are Sam.',
      claude,
      model: 'claude-opus-5-5',
      effort: 'low',
      ledger: new ReplyLedger<RepAction>(),
      logger: log(),
    });
    session = new voice.AgentSession({});
    await session.start({ agent });

    await session.run({ userInput: 'Voltline, Rachel speaking.' }).wait();
    expect(asLines(sent[0])).toEqual(['user: Voltline, Rachel speaking.']);
    expect(sent[0]).toMatchObject({ system: [{ text: 'You are Sam.' }], tools: REP_TOOLS });

    await session.run({ userInput: "Go on, but I've got a meeting." }).wait();
    expect(asLines(sent[1])).toEqual([
      'user: Voltline, Rachel speaking.',
      "assistant: Hi Rachel, it's Sam from WattGuard. Have I caught you at a bad time?",
      "user: Go on, but I've got a meeting.",
    ]);
    expect(spokenLines(agent)).toEqual([
      'user: Voltline, Rachel speaking.',
      "assistant: Hi Rachel, it's Sam from WattGuard. Have I caught you at a bad time?",
      "user: Go on, but I've got a meeting.",
      'assistant: How do you report energy to clients today?',
    ]);
  });

  it('says goodbye for a reply that was only a hang-up, and ties the tools to the line that was heard', async () => {
    const { claude } = scriptedClaude([
      [{ type: 'tool_use', id: 't1', name: 'end_call', input: { reason: 'She asked me to go' } }],
    ]);
    const ledger = new ReplyLedger<RepAction>();
    const agent = new RepAgent({
      system: 'You are Sam.',
      claude,
      model: 'claude-opus-5-5',
      effort: 'low',
      ledger,
      logger: log(),
    });
    session = new voice.AgentSession({});
    await session.start({ agent });
    await session.run({ userInput: 'Take me off your list.' }).wait();

    const said = agent.chatCtx.items.find(
      (item) => item.type === 'message' && item.role === 'assistant',
    );
    expect(said?.type === 'message' && said.textContent).toBe('Thanks for your time. Bye.');
    const reply = said?.type === 'message' ? ledger.committed(said.extra[REPLY_ID_KEY]) : undefined;
    expect(reply?.actions).toEqual([{ type: 'end_call', reason: 'She asked me to go' }]);
  });
});
