// What each Claude model accepts, so request builders never send a parameter
// that would 400 mid-call. Unknown models get the conservative profile.

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ModelCapabilities {
  /** `output_config.effort`. Haiku 4.5 rejects it. */
  effort: boolean;
  /** `{ role: 'system' }` entries inside `messages` (after a user turn). */
  midConversationSystem: boolean;
  /** Server-side refusal fallbacks: `fallbacks: 'default'` + its beta header. */
  serverFallbacks: boolean;
}

const CONSERVATIVE: ModelCapabilities = {
  effort: false,
  midConversationSystem: false,
  serverFallbacks: false,
};

const FAMILIES: ReadonlyArray<[RegExp, ModelCapabilities]> = [
  [/^claude-opus-5$/, { effort: true, midConversationSystem: true, serverFallbacks: true }],
  [/^claude-fable-5-1$/, { effort: true, midConversationSystem: true, serverFallbacks: true }],
  [/^claude-opus-5-5$/, { effort: true, midConversationSystem: true, serverFallbacks: true }],
  [/^claude-fable-5$/, { effort: true, midConversationSystem: true, serverFallbacks: false }],
  [/^claude-opus-4-8$/, { effort: true, midConversationSystem: true, serverFallbacks: false }],
  [/^claude-sonnet-5$/, { effort: true, midConversationSystem: false, serverFallbacks: false }],
  [
    /^claude-(opus-4-[67]|sonnet-4-6)$/,
    { effort: true, midConversationSystem: false, serverFallbacks: false },
  ],
  [/^claude-haiku-4-5/, CONSERVATIVE],
];

export function modelCapabilities(model: string): ModelCapabilities {
  return FAMILIES.find(([pattern]) => pattern.test(model))?.[1] ?? CONSERVATIVE;
}

/** The beta header that enables `fallbacks: 'default'`. */
export const SERVER_FALLBACK_BETA = 'server-side-fallback-2026-07-01';
