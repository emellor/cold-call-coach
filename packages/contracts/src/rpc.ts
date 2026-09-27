// RPC, web → agent (PLAN.md §9). The web calls
// `localParticipant.performRpc({ destinationIdentity, method, payload: '' })`
// and validates the JSON answer; the agent registers each method with
// `localParticipant.registerRpcMethod` and answers only the rep.
import { z } from 'zod';

export const RpcOk = z.object({
  ok: z.boolean(),
  /** Why it didn't happen, in words for the rep. */
  reason: z.string().optional(),
});
export type RpcOk = z.infer<typeof RpcOk>;

/**
 * Get help: the words to say next, why they fit this point of the call, and what
 * to say if she pushes back (left out when Claude gave none). The RPC keeps its
 * original name, `call.hint`, as do the `hint` event and cost lane.
 */
export const HintResponse = z.object({
  say: z.string().min(1),
  why: z.string().min(1),
  ifPushback: z.string().min(1).optional(),
});
export type HintResponse = z.infer<typeof HintResponse>;

/** What Get help asks Claude for (structured output; the lengths are stated, not enforced). */
export const HintDraft = z.object({
  say: z
    .string()
    .describe(
      'The exact words the rep should say next, as they would say them aloud: at most 35 words',
    ),
  why: z
    .string()
    .describe(
      'Why this line now: the stage of the call and the technique it uses, in one short sentence',
    ),
  ifPushback: z
    .string()
    .describe(
      "What the rep should say if she pushes back on that line, in the rep's words: at most 30 words",
    ),
});
export type HintDraft = z.infer<typeof HintDraft>;

export interface RpcMethod<S extends z.ZodType> {
  readonly name: string;
  readonly response: S;
}

const method = <S extends z.ZodType>(name: string, response: S): RpcMethod<S> => ({
  name,
  response,
});

export const RpcMethods = {
  pause: method('call.pause', RpcOk),
  resume: method('call.resume', RpcOk),
  hint: method('call.hint', HintResponse),
  rewind: method('call.rewind', RpcOk),
  hangup: method('call.hangup', RpcOk),
} as const;

/** Parses an RPC answer, or throws with what was wrong with it. */
export function parseRpcResponse<S extends z.ZodType>(rpc: RpcMethod<S>, text: string): z.infer<S> {
  return rpc.response.parse(JSON.parse(text));
}
