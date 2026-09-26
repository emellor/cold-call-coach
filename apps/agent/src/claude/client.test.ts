import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClaude } from './client.ts';

/** The headers of the one request a client makes. */
async function headersSent(workspaceId?: string): Promise<Headers> {
  const fetch = vi.fn<typeof globalThis.fetch>(() =>
    Promise.resolve(Response.json({ data: [], has_more: false, first_id: null, last_id: null })),
  );
  vi.stubGlobal('fetch', fetch);
  await createClaude('sk-test', workspaceId).models.list();
  expect(fetch).toHaveBeenCalledTimes(1);
  return new Headers(fetch.mock.calls[0]?.[1]?.headers);
}

describe('createClaude', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('names the workspace on every request when one is set', async () => {
    const headers = await headersSent('wrkspc_01AbC');
    expect(headers.get('anthropic-workspace-id')).toBe('wrkspc_01AbC');
    expect(headers.get('x-api-key')).toBe('sk-test');
  });

  it('sends no workspace otherwise', async () => {
    expect((await headersSent()).get('anthropic-workspace-id')).toBeNull();
  });
});
