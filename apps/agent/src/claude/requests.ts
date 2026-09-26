import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { type ChatTurn, type Effort, SERVER_FALLBACK_BETA, modelCapabilities } from '@ccc/core';

/** Room for one or two spoken sentences (plus any adaptive thinking at low effort). */
export const PROSPECT_MAX_TOKENS = 300;

/**
 * The prospect's request. Never carries temperature, top_p or top_k: Opus 5
 * rejects them. Effort and server-side refusal fallbacks are sent only to
 * models that accept them (Haiku 4.5 takes neither).
 */
export function prospectRequest(input: {
  model: string;
  effort: Effort;
  persona: string;
  messages: ChatTurn[];
}): BetaMessageStreamParams {
  const caps = modelCapabilities(input.model);
  return {
    model: input.model,
    max_tokens: PROSPECT_MAX_TOKENS,
    // The persona is stable for the whole call, so it caches from turn 2.
    system: [{ type: 'text', text: input.persona, cache_control: { type: 'ephemeral' } }],
    messages: input.messages,
    ...(caps.effort ? { output_config: { effort: input.effort } } : {}),
    ...(caps.serverFallbacks ? { betas: [SERVER_FALLBACK_BETA], fallbacks: 'default' } : {}),
  };
}
