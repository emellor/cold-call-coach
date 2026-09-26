// Claude API keys that belong to no workspace. A key bound to a user or a service
// account can be scoped to the whole organization instead of one workspace, and
// Claude then refuses every request with a 400 unless it names a workspace in the
// `anthropic-workspace-id` header. The SDK sends that header only for its own
// sign-in credentials, never with an API key, so the apps send it themselves when
// ANTHROPIC_WORKSPACE_ID is set.

/** The request header that picks the workspace for a key that has none. */
export const WORKSPACE_HEADER = 'anthropic-workspace-id';

/** Workspace IDs are tagged, `wrkspc_…`; a workspace's name is not its ID. */
export const WORKSPACE_ID = /^wrkspc_\S+$/;
export const WORKSPACE_ID_PROBLEM = 'must be a workspace ID, which starts with wrkspc_';

/** The headers every Claude request carries: the workspace, when one is set. */
export function claudeHeaders(workspaceId: string | undefined): Record<string, string> | undefined {
  return workspaceId ? { [WORKSPACE_HEADER]: workspaceId } : undefined;
}

/** The message in a Claude API error's body (`{ error: { message } }`), if it has one. */
export function claudeErrorMessage(body: unknown): string | undefined {
  const error = isRecord(body) ? body.error : undefined;
  const message = isRecord(error) ? error.message : undefined;
  return typeof message === 'string' && message.trim() ? message.trim() : undefined;
}

/** Whether Claude refused a request because its key belongs to no workspace. */
export const isNoWorkspaceRefusal = (status: unknown, message: string | undefined) =>
  status === 400 && message !== undefined && /not scoped to a workspace/i.test(message);

/** That refusal as a sentence naming both fixes. `service` holds the key: the agent or the API. */
export const describeNoWorkspace = (service: 'agent' | 'API') =>
  `Claude refused the ${service}'s key because it isn't in a workspace: use an ` +
  'ANTHROPIC_API_KEY created in a workspace, or set ANTHROPIC_WORKSPACE_ID to one (wrkspc_…).';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
