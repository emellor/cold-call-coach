import Anthropic from '@anthropic-ai/sdk';
import { claudeHeaders } from '@ccc/core';

/**
 * One Anthropic client per call, shared by the prospect and the judge (and by
 * scripts/simulate-call.ts). The SDK's default retries cover overloads. A key that
 * belongs to no workspace needs `workspaceId` (ANTHROPIC_WORKSPACE_ID) on every request.
 */
export const createClaude = (apiKey: string, workspaceId?: string): Anthropic =>
  new Anthropic({ apiKey, defaultHeaders: claudeHeaders(workspaceId) });

// Re-exported for scripts/simulate-call.ts, which reaches the SDK through the agent.
export type {
  BetaMessage,
  BetaRawMessageStreamEvent,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
