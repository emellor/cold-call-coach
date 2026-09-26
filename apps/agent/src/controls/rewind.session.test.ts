// Rewind against LiveKit's real AgentSession and the real ProspectAgent, in
// LiveKit's text-only mode (no room, no audio): the conversation Claude sees on
// the retake must no longer hold the turn that was taken back.
import type {
  BetaMessage,
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { initializeLogger, log, voice } from '@livekit/agents';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StreamingMessages } from '../claude/textStream.ts';
import { ProspectAgent } from '../prospect/agent.ts';
import { ReplyLedger } from '../prospect/replies.ts';
import { silentLogger } from '../test/fixtures.ts';
import { CallControls } from './controls.ts';

initializeLogger({ pretty: false, level: 'silent' });

/** Claude as the prospect: answers each request with the next line. */
function scriptedClaude(lines: string[]) {
  const sent: BetaMessageStreamParams[] = [];
  const claude: StreamingMessages = {
    stream(params) {
      sent.push(params);
      const text = lines.shift() ?? 'Mm.';
      return {
        async *[Symbol.asyncIterator]() {
          yield await Promise.resolve({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text },
          } as BetaRawMessageStreamEvent);
        },
        finalMessage: () =>
          Promise.resolve({
            model: params.model,
            stop_reason: 'end_turn',
            content: [{ type: 'text', text }],
            usage: { input_tokens: 1, output_tokens: 1 },
          } as unknown as BetaMessage),
      };
    },
  };
  return { claude, sent };
}

const NOTE = '\n\n<private_note>\n(note)\n</private_note>';

/** The conversation as Claude was sent it, one line per message. */
const asLines = (params: BetaMessageStreamParams | undefined) =>
  (params?.messages ?? []).map(
    (m) => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`,
  );

describe('rewind, on a real LiveKit session', () => {
  let session: voice.AgentSession | undefined;
  afterEach(async () => {
    await session?.close();
    session = undefined;
  });

  it('truncates what Claude sees, and she repeats her line without it being added again', async () => {
    const { claude, sent } = scriptedClaude([
      "Just email me. I'm busy.",
      'Around forty grand a year.',
    ]);
    const agent = new ProspectAgent({
      persona: 'You are Claire Hughes.',
      claude,
      model: 'claude-haiku-4-5', // the note rides on the user turn: no system messages to filter
      effort: 'low',
      brain: { note: () => '(note)', hangUpDue: false },
      ledger: new ReplyLedger(),
      logger: log(),
    });
    session = new voice.AgentSession({});
    await session.start({ agent });
    await session.say('Claire Hughes.').waitForPlayout();
    await session.run({ userInput: 'Can I send you a brochure?' }).wait();
    expect(asLines(sent[0])).toEqual([
      'user: (Your phone rings and you answer.)',
      'assistant: Claire Hughes.',
      `user: Can I send you a brochure?${NOTE}`,
    ]);

    const said = vi.fn<(source: string) => void>();
    session.on(voice.AgentSessionEventTypes.SpeechCreated, (event) => {
      said(event.source);
    });
    const brain = { repTurns: 1, meeting: null, rewindTo: vi.fn() };
    const controls = new CallControls({
      mode: 'coached',
      session,
      agent,
      brain,
      recorder: { event: vi.fn(), rewind: () => null, metricTurns: () => [] },
      coach: { paused: vi.fn(), resumed: vi.fn(), rewound: vi.fn(), turnsChanged: vi.fn() },
      controller: { phase: 'connected', end: vi.fn(() => Promise.resolve()) },
      hints: vi.fn(),
      hintPrompt: () => ({ system: '', user: '' }),
      logger: silentLogger,
    });

    await expect(controls.rewind()).resolves.toEqual({ ok: true });
    expect(brain.rewindTo).toHaveBeenCalledWith(1);
    expect(said).toHaveBeenCalledWith('say');
    // Her repeated line plays but is not added to the conversation a second time.
    await vi.waitFor(() => expect(session?.agentState).toBe('listening'));
    const spoken = agent.chatCtx.items.flatMap((item) =>
      item.type === 'message' && item.role !== 'system'
        ? [`${item.role}: ${item.textContent}`]
        : [],
    );
    expect(spoken).toEqual(['assistant: Claire Hughes.']);

    // The retake: Claude sees the call as if the brochure line was never said.
    await session.run({ userInput: 'What does energy cost you today?' }).wait();
    expect(asLines(sent[1])).toEqual([
      'user: (Your phone rings and you answer.)',
      'assistant: Claire Hughes.',
      `user: What does energy cost you today?${NOTE}`,
    ]);
  });
});
