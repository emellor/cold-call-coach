import type {
  BetaMessageParam,
  BetaMessageStreamParams,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { HintDraft, JudgeResult } from '@ccc/contracts';
import {
  type ChatTurn,
  type Effort,
  HINT_MAX_TOKENS,
  SERVER_FALLBACK_BETA,
  modelCapabilities,
  structuredFormat,
} from '@ccc/core';
import { PROSPECT_TOOLS } from '../prospect/tools.ts';

/** Room for one or two spoken sentences, a tool call, and any adaptive thinking at low effort. */
export const PROSPECT_MAX_TOKENS = 512;

/** The judge's JSON is small; the rest is headroom for adaptive thinking. */
export const JUDGE_MAX_TOKENS = 2048;

/** Built once: an unchanged schema is compiled once by the API and then cached. */
const JUDGE_FORMAT = structuredFormat(JudgeResult);
const HINT_FORMAT = structuredFormat(HintDraft);

/** Effort and server-side refusal fallbacks, for the models that accept them (Haiku 4.5 takes neither). */
function modelOptions(model: string, effort: Effort) {
  const caps = modelCapabilities(model);
  return {
    effort: caps.effort ? { effort } : {},
    fallbacks: caps.serverFallbacks
      ? { betas: [SERVER_FALLBACK_BETA], fallbacks: 'default' as const }
      : {},
  };
}

/**
 * The prospect's request. Never carries temperature, top_p or top_k: Opus 5
 * rejects them. The tools and the persona are the same every turn, so the
 * prefix up to the persona caches from turn 2, and the conversation up to her
 * last reply is cached as well (`withHistoryBreakpoint`).
 */
export function prospectRequest(input: {
  model: string;
  effort: Effort;
  persona: string;
  messages: ChatTurn[];
}): BetaMessageStreamParams {
  const options = modelOptions(input.model, input.effort);
  return {
    model: input.model,
    max_tokens: PROSPECT_MAX_TOKENS,
    tools: PROSPECT_TOOLS,
    system: [{ type: 'text', text: input.persona, cache_control: { type: 'ephemeral' } }],
    messages: withHistoryBreakpoint(input.messages),
    ...(Object.keys(options.effort).length ? { output_config: options.effort } : {}),
    ...options.fallbacks,
  };
}

/**
 * Marks her last reply as a cache breakpoint. Each of her requests resends the
 * whole conversation, several times a turn while LiveKit drafts replies early,
 * and without this all of it after the persona was billed at the full input
 * price every time. Everything before her last reply is settled, so it is read
 * from the cache. What follows it is sent at full price: the rep's latest words,
 * which change while a draft is revised, and the state note.
 */
export function withHistoryBreakpoint(messages: readonly ChatTurn[]): BetaMessageParam[] {
  const last = messages.findLastIndex((m) => m.role === 'assistant');
  return messages.map((m, i) =>
    i === last
      ? {
          role: m.role,
          content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }],
        }
      : m,
  );
}

/**
 * The judge's request: structured output constrained to JudgeResult, parsed by
 * `client.beta.messages.parse`. The system prompt is fixed for the call.
 */
export function judgeRequest(input: {
  model: string;
  effort: Effort;
  system: string;
  user: string;
}) {
  const options = modelOptions(input.model, input.effort);
  return {
    model: input.model,
    max_tokens: JUDGE_MAX_TOKENS,
    system: [
      { type: 'text' as const, text: input.system, cache_control: { type: 'ephemeral' as const } },
    ],
    messages: [{ role: 'user' as const, content: input.user }],
    output_config: { ...options.effort, format: JUDGE_FORMAT },
    ...options.fallbacks,
  };
}

/**
 * The Hint button's request (PLAN.md §8.3): three lines as structured output,
 * on the coach's model and effort. The system prompt is fixed for the call.
 */
export function hintRequest(input: {
  model: string;
  effort: Effort;
  system: string;
  user: string;
}) {
  const options = modelOptions(input.model, input.effort);
  return {
    model: input.model,
    max_tokens: HINT_MAX_TOKENS,
    system: [
      { type: 'text' as const, text: input.system, cache_control: { type: 'ephemeral' as const } },
    ],
    messages: [{ role: 'user' as const, content: input.user }],
    output_config: { ...options.effort, format: HINT_FORMAT },
    ...options.fallbacks,
  };
}
