// The prospect's two side-channel tools (PLAN.md §6.4). Her reply streams to
// TTS as text; any tool_use blocks are read from the finished message and
// acted on once that reply has been heard in full. No tool result is ever sent
// back: the next request is rebuilt from the spoken text alone.
import type {
  BetaMessage,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { z } from 'zod';

export const EndCallInput = z.object({ reason: z.string().trim().min(1) });
export const AgreeToMeetingInput = z.object({ when: z.string().trim().min(1) });

export type ProspectAction =
  { type: 'end_call'; reason: string } | { type: 'agree_to_meeting'; when: string };

export const PROSPECT_TOOLS: BetaToolUnion[] = [
  {
    name: 'end_call',
    description:
      "Hang up. Say a brief goodbye in this reply first; the line goes dead once you've finished speaking. Use it when you've had enough, or when the conversation is over.",
    input_schema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: "Why you're hanging up, in a few words. Not spoken aloud.",
        },
      },
      required: ['reason'],
    },
    // Streamed tools default to eager input streaming (claude-api skill); the
    // input is validated with zod before anything acts on it.
    eager_input_streaming: true,
  },
  {
    name: 'agree_to_meeting',
    description:
      'Record that you have agreed to a meeting. Call it only in the reply where you confirm, out loud, a specific day and time the caller proposed.',
    input_schema: {
      type: 'object',
      properties: {
        when: {
          type: 'string',
          description: "The day and time you agreed, as said on the call, e.g. 'Tuesday at 10am'.",
        },
      },
      required: ['when'],
    },
    eager_input_streaming: true,
  },
];

export interface ToolLogger {
  warn(obj: object, msg: string): void;
}

/**
 * The actions in a finished reply. A reply cut short by max_tokens or a refusal
 * may hold a truncated tool call, so none of its tools run; an input that fails
 * its schema is dropped.
 */
export function actionsFromMessage(message: BetaMessage, logger?: ToolLogger): ProspectAction[] {
  if (message.stop_reason === 'max_tokens' || message.stop_reason === 'refusal') {
    const tools = message.content.filter((b) => b.type === 'tool_use').map((b) => b.name);
    if (tools.length) {
      logger?.warn(
        { tools, stopReason: message.stop_reason },
        'reply was cut short; ignoring its tools',
      );
    }
    return [];
  }
  const actions: ProspectAction[] = [];
  for (const block of message.content) {
    if (block.type !== 'tool_use') continue;
    if (block.name === 'end_call') {
      const input = EndCallInput.safeParse(block.input);
      if (input.success) actions.push({ type: 'end_call', reason: input.data.reason });
      else
        logger?.warn({ tool: block.name, input: block.input }, 'invalid tool input; ignoring it');
    } else if (block.name === 'agree_to_meeting') {
      const input = AgreeToMeetingInput.safeParse(block.input);
      if (input.success) actions.push({ type: 'agree_to_meeting', when: input.data.when });
      else
        logger?.warn({ tool: block.name, input: block.input }, 'invalid tool input; ignoring it');
    } else {
      logger?.warn({ tool: block.name }, 'unknown tool; ignoring it');
    }
  }
  return actions;
}

/** What she says when a reply was only a tool call, so the line never just goes dead. */
export function closingLine(actions: readonly ProspectAction[]): string | undefined {
  const meeting = actions.find((a) => a.type === 'agree_to_meeting');
  const hangUp = actions.some((a) => a.type === 'end_call');
  if (meeting && hangUp) return `Fine, ${meeting.when} then. Bye.`;
  if (meeting) return `Fine, ${meeting.when} then.`;
  if (hangUp) return 'Right. Goodbye.';
  return undefined;
}
