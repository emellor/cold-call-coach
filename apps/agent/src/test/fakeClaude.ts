// A fake Claude for the simulation harness: the rep reads from a script, the
// judge scores by keywords, and the prospect follows her note.
import type { JudgeResult } from '@ccc/contracts';
import type { BetaMessage } from '../claude/client.ts';
import type { SimMessages } from '../simulate/harness.ts';

const usage = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0 };

/** The text of a message the harness sent (always a plain string here). */
const textOf = (message: { content: unknown } | undefined): string =>
  typeof message?.content === 'string' ? message.content : '';

function signalsFor(line: string): JudgeResult['signals'] {
  return {
    askedPermission: /thirty seconds/i.test(line),
    gaveRelevantReason: /energy bills/i.test(line),
    askedOpenQuestion: /^how\b/i.test(line),
    followedUp: /^how\b/i.test(line),
    acknowledgedObjection: false,
    pitchedFeatures: /features/i.test(line),
    ignoredHerPoint: /features/i.test(line),
    pushy: false,
    rude: false,
    askedForMeeting: /tuesday at 10/i.test(line),
    proposedSpecificTime: /tuesday at 10/i.test(line),
  };
}

/**
 * A fake Claude. The rep says `lines` in order. The prospect agrees whenever a
 * time is proposed, whatever her note says (so the meeting rule is what stops a
 * bad booking), and says goodbye with end_call when her note says she's done.
 */
export function fakeClaude(lines: string[]) {
  const script = [...lines];
  const seen = { repCalls: 0, notes: [] as string[] };
  const text = (t: string) => ({ type: 'text', text: t });
  const messages: SimMessages = {
    create: (params) => {
      seen.repCalls += 1;
      return Promise.resolve({
        model: params.model,
        content: [text(script.shift() ?? 'Anyway.')],
        usage,
        stop_reason: 'end_turn',
      } as unknown as BetaMessage);
    },
    parse: (params) => {
      const user = textOf(params.messages.at(-1));
      const latest = /LATEST Rep: (.*)/.exec(user)?.[1] ?? '';
      const result: JudgeResult = {
        stage: 'other',
        signals: signalsFor(latest),
        revealEarned: null,
        tip: null,
      };
      return Promise.resolve({
        model: params.model,
        stop_reason: 'end_turn',
        usage,
        content: [],
        parsed_output: result,
      } as unknown as BetaMessage & { parsed_output: unknown });
    },
    stream: (params) => {
      const note = textOf(params.messages.at(-1));
      seen.notes.push(note);
      const caller = textOf(params.messages.at(-2));
      const content: Array<Record<string, unknown>> = [];
      let say = 'Go on.';
      if (note.includes('call end_call')) {
        say = "Right, I've heard enough. Goodbye.";
        content.push({
          type: 'tool_use',
          id: 't1',
          name: 'end_call',
          input: { reason: 'Waste of time' },
        });
      } else if (/tuesday at 10/i.test(caller)) {
        say = 'Fine, Tuesday at ten.';
        content.push({
          type: 'tool_use',
          id: 't2',
          name: 'agree_to_meeting',
          input: { when: 'Tuesday at 10am' },
        });
      }
      return {
        async *[Symbol.asyncIterator]() {
          yield await Promise.resolve({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: say },
          } as never);
        },
        finalMessage: () =>
          Promise.resolve({
            model: params.model,
            stop_reason: content.length ? 'tool_use' : 'end_turn',
            usage,
            content: [text(say), ...content],
          } as unknown as BetaMessage),
      };
    },
  };
  return { messages, seen };
}
