import Anthropic from '@anthropic-ai/sdk';

/**
 * One Anthropic client per call, shared by the prospect and the judge (and by
 * scripts/simulate-call.ts). The SDK's default retries cover overloads.
 */
export const createClaude = (apiKey: string): Anthropic => new Anthropic({ apiKey });

// Re-exported for scripts/simulate-call.ts, which reaches the SDK through the agent.
export type {
  BetaMessage,
  BetaRawMessageStreamEvent,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
