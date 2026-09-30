// Sam's two side-channel tools in a reverse call, like hers on a normal one
// (prospect/tools.ts): his reply streams to TTS as text, and any tool_use
// blocks are read from the finished message and acted on once the reply has
// been heard in full. No tool result is sent back.
import type {
  BetaMessage,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { AgreeToMeetingInput, EndCallInput, type ToolLogger } from '../prospect/tools.ts';

export type RepAction =
  { type: 'book_meeting'; when: string } | { type: 'end_call'; reason: string };

export const REP_TOOLS: BetaToolUnion[] = [
  {
    name: 'book_meeting',
    description:
      'Record the meeting she has agreed to. Call it only in the reply where you confirm back, out loud, the specific day and time she accepted.',
    input_schema: {
      type: 'object',
      properties: {
        when: {
          type: 'string',
          description: "The day and time she agreed, as said on the call, e.g. 'Tuesday at 10am'.",
        },
      },
      required: ['when'],
    },
    // Streamed tools default to eager input streaming (claude-api skill); the
    // input is validated with zod before anything acts on it.
    eager_input_streaming: true,
  },
  {
    name: 'end_call',
    description:
      "Hang up. Say a brief goodbye in this reply first; the line goes dead once you've finished speaking. Use it once the meeting is booked and you've said goodbye, or once she has ended the conversation.",
    input_schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Why the call is ending, in a few words. Not spoken aloud.',
        },
      },
      required: ['reason'],
    },
    eager_input_streaming: true,
  },
];

/**
 * The actions in Sam's finished reply. A reply cut short by max_tokens or a
 * refusal may hold a truncated tool call, so none of its tools run; an input
 * that fails its schema is dropped.
 */
export function repActionsFromMessage(message: BetaMessage, logger?: ToolLogger): RepAction[] {
  if (message.stop_reason === 'max_tokens' || message.stop_reason === 'refusal') {
    const tools = message.content.filter((b) => b.type === 'tool_use').map((b) => b.name);
    if (tools.length) {
      logger?.warn(
        { tools, stopReason: message.stop_reason },
        "Sam's reply was cut short; ignoring its tools",
      );
    }
    return [];
  }
  const actions: RepAction[] = [];
  for (const block of message.content) {
    if (block.type !== 'tool_use') continue;
    if (block.name === 'book_meeting') {
      const input = AgreeToMeetingInput.safeParse(block.input);
      if (input.success) actions.push({ type: 'book_meeting', when: input.data.when });
      else
        logger?.warn({ tool: block.name, input: block.input }, 'invalid tool input; ignoring it');
    } else if (block.name === 'end_call') {
      const input = EndCallInput.safeParse(block.input);
      if (input.success) actions.push({ type: 'end_call', reason: input.data.reason });
      else
        logger?.warn({ tool: block.name, input: block.input }, 'invalid tool input; ignoring it');
    } else {
      logger?.warn({ tool: block.name }, 'unknown tool; ignoring it');
    }
  }
  return actions;
}

/** What Sam says when a reply was only a tool call, so the line never just goes dead. */
export function repClosingLine(actions: readonly RepAction[]): string | undefined {
  const meeting = actions.find((a) => a.type === 'book_meeting');
  const hangUp = actions.some((a) => a.type === 'end_call');
  if (meeting && hangUp) return `Great, ${meeting.when} it is. Thanks, bye.`;
  if (meeting) return `Great, ${meeting.when} it is.`;
  if (hangUp) return 'Thanks for your time. Bye.';
  return undefined;
}

export interface RepActionDeps {
  controller: {
    recordMeeting(when: string): Promise<void>;
    end(outcome: 'ended_by_rep', reason?: string): Promise<void>;
  };
  logger: { info(obj: object, msg: string): void };
  /** Keeps what happened for the call log. */
  record?: (kind: 'tool_call' | 'meeting', payload: Record<string, unknown>) => void;
}

/**
 * Acts on a reply of Sam's that she heard in full: the meeting first, so a
 * "Tuesday at ten, bye" call ends as booked; then the hang-up. She is played by
 * the rep, who decides whether to agree, so a meeting Sam books stands.
 */
export async function actOnRepReply(
  actions: readonly RepAction[],
  turn: number,
  deps: RepActionDeps,
): Promise<void> {
  const { controller, logger, record } = deps;
  const meeting = actions.find((a) => a.type === 'book_meeting');
  if (meeting) {
    logger.info({ turn, when: meeting.when }, 'book_meeting');
    record?.('tool_call', { turn, name: 'book_meeting', when: meeting.when });
    record?.('meeting', { turn, when: meeting.when, booked: true });
    await controller.recordMeeting(meeting.when);
  }
  const endCall = actions.find((a) => a.type === 'end_call');
  if (endCall) {
    logger.info({ turn, reason: endCall.reason }, 'end_call');
    record?.('tool_call', { turn, name: 'end_call', reason: endCall.reason });
    await controller.end('ended_by_rep', endCall.reason);
  }
}
