// Provider failures in words the rep can act on, for call.notice and for the
// reason a failed call ends with. Keys are named by their .env variable.
import { APIError, APIUserAbortError } from '@anthropic-ai/sdk';
import { claudeErrorMessage, describeNoWorkspace, isNoWorkspaceRefusal } from '@ccc/core';
import { APIConnectionError, APIStatusError, APITimeoutError } from '@livekit/agents';

export const CLAUDE_TIMED_OUT = 'Claude took too long to answer.';
export const CLAUDE_UNREACHABLE = 'Claude could not be reached.';

/** A Claude request that failed, as one sentence. */
export function describeClaudeFailure(error: unknown): string {
  if (
    error instanceof APIUserAbortError ||
    (error instanceof Error && error.name === 'TimeoutError')
  ) {
    return CLAUDE_TIMED_OUT;
  }
  if (error instanceof APIError) {
    const said = claudeErrorMessage(error.error);
    if (isNoWorkspaceRefusal(error.status, said)) return describeNoWorkspace('agent');
    if (error.status === 401 || error.status === 403) {
      return "Claude rejected the agent's key: check ANTHROPIC_API_KEY.";
    }
    if (error.status === 429) return 'Claude is rate-limiting this key.';
    if (error.status === 529 || error.status === 503) return 'Claude is overloaded right now.';
    // Anything else is best told in Claude's own words; a bare status says nothing.
    if (error.status !== undefined) {
      return said
        ? `Claude failed (${error.status}): ${said.replace(/[.\s]+$/, '')}.`
        : `Claude failed (${error.status}).`;
    }
  }
  return CLAUDE_UNREACHABLE;
}

export type VoiceProvider = 'stt' | 'tts';

const PROVIDERS: Record<VoiceProvider, { label: string; key: string }> = {
  stt: { label: 'Hearing you (Deepgram)', key: 'DEEPGRAM_API_KEY' },
  tts: { label: 'Her voice (Cartesia)', key: 'CARTESIA_API_KEY' },
};

/** A speech provider's failure, as LiveKit reported it, as one sentence. */
export function describeVoiceFailure(provider: VoiceProvider, error: unknown): string {
  const { label, key } = PROVIDERS[provider];
  const message = (error instanceof Error ? error.message : String(error)).trim();
  const status = error instanceof APIStatusError ? error.statusCode : undefined;
  if (
    status === 401 ||
    status === 403 ||
    /\b(401|403)\b|unauthori[sz]ed|forbidden|invalid api key/i.test(message)
  ) {
    return `${label} rejected the agent's key: check ${key}.`;
  }
  if (status === 429 || /\b429\b|rate.?limit/i.test(message)) {
    return `${label} is rate-limiting this key.`;
  }
  // The socket never opened, and the plugins' message then says little more than "Error".
  if (error instanceof APITimeoutError) return `${label} timed out.`;
  if (error instanceof APIConnectionError) return `${label} could not be reached.`;
  return `${label} failed: ${message || 'no reason given'}`;
}
