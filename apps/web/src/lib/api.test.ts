import { afterEach, describe, expect, it, vi } from 'vitest';
import { rerunReview, signIn, signOut } from './api.ts';

/** Stubs fetch with `response` and returns the content-type of the one request made. */
function contentTypeSent(response: () => Response): () => string | null {
  const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(response()));
  vi.stubGlobal('fetch', fetch);
  return () => {
    expect(fetch).toHaveBeenCalledTimes(1);
    return new Headers(fetch.mock.calls[0]?.[1]?.headers).get('content-type');
  };
}

describe('send', () => {
  afterEach(() => vi.unstubAllGlobals());

  // The API answers 400 to an empty body labelled JSON ("Body cannot be empty when
  // content-type is set to 'application/json'"): signing out then never cleared the
  // cookie, and a failed review could never be rerun.
  it("doesn't label a request without a body as JSON", async () => {
    const signedOut = contentTypeSent(() => new Response(null, { status: 204 }));
    await signOut();
    expect(signedOut()).toBeNull();

    const rerun = contentTypeSent(() => Response.json({ status: 'pending' }, { status: 202 }));
    await expect(rerunReview('call-1')).resolves.toEqual({ status: 'pending' });
    expect(rerun()).toBeNull();
  });

  it('labels a request with a body as JSON', async () => {
    const signedIn = contentTypeSent(() => new Response(null, { status: 204 }));
    await signIn('correct horse battery');
    expect(signedIn()).toBe('application/json');
  });
});
