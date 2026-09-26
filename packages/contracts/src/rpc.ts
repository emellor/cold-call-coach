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

/** Three lines as asked for; fewer only if Claude returned duplicates or blanks. */
export const HintResponse = z.object({ suggestions: z.array(z.string().min(1)).min(1).max(3) });
export type HintResponse = z.infer<typeof HintResponse>;

/** What the hint call asks Claude for (structured output; the lengths are stated, not enforced). */
export const HintDraft = z.object({
  suggestions: z
    .array(z.string().describe('One line the rep could say next, at most 20 words'))
    .describe('Exactly three different lines, best first'),
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
