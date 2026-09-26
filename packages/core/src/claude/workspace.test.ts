import { describe, expect, it } from 'vitest';
import {
  WORKSPACE_ID,
  claudeErrorMessage,
  claudeHeaders,
  describeNoWorkspace,
  isNoWorkspaceRefusal,
} from './workspace.ts';

/** What Claude answered, word for word, for a key scoped to the organization. */
const NO_WORKSPACE =
  'This API key is not scoped to a workspace, so this request must include the ' +
  'anthropic-workspace-id header with the ID of the workspace to use. Add the header, ' +
  'or use an API key that is scoped to a workspace.';

describe('claudeHeaders', () => {
  it('names the workspace only when one is set', () => {
    expect(claudeHeaders('wrkspc_01AbC')).toEqual({ 'anthropic-workspace-id': 'wrkspc_01AbC' });
    expect(claudeHeaders(undefined)).toBeUndefined();
  });
});

describe('WORKSPACE_ID', () => {
  it('takes a tagged ID, not a workspace name', () => {
    expect(WORKSPACE_ID.test('wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ')).toBe(true);
    expect(WORKSPACE_ID.test('Default')).toBe(false);
    expect(WORKSPACE_ID.test('wrkspc_')).toBe(false);
  });
});

describe('claudeErrorMessage', () => {
  it("reads Claude's own words out of an error body", () => {
    const body = { type: 'error', error: { type: 'invalid_request_error', message: NO_WORKSPACE } };
    expect(claudeErrorMessage(body)).toBe(NO_WORKSPACE);
  });

  it('is undefined for a body without them', () => {
    expect(claudeErrorMessage(undefined)).toBeUndefined();
    expect(claudeErrorMessage('Bad Request')).toBeUndefined();
    expect(claudeErrorMessage({ error: { message: ' ' } })).toBeUndefined();
  });
});

describe('isNoWorkspaceRefusal', () => {
  it("is Claude's 400 for a key that belongs to no workspace, and nothing else", () => {
    expect(isNoWorkspaceRefusal(400, NO_WORKSPACE)).toBe(true);
    expect(isNoWorkspaceRefusal(401, NO_WORKSPACE)).toBe(false);
    expect(isNoWorkspaceRefusal(400, 'max_tokens: Field required')).toBe(false);
    expect(isNoWorkspaceRefusal(400, undefined)).toBe(false);
  });
});

describe('describeNoWorkspace', () => {
  it('names the service, the key and both ways out', () => {
    expect(describeNoWorkspace('agent')).toBe(
      "Claude refused the agent's key because it isn't in a workspace: use an " +
        'ANTHROPIC_API_KEY created in a workspace, or set ANTHROPIC_WORKSPACE_ID to one (wrkspc_…).',
    );
  });
});
