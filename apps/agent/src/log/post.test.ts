import { INTERNAL_SECRET_HEADER } from '@ccc/contracts';
import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '../test/fixtures.ts';
import { postCallLog } from './post.ts';

const log = {
  outcome: 'ended_by_rep' as const,
  connectedAt: null,
  endedAt: '2026-09-26T10:00:00.000Z',
  durationMs: 0,
  turns: [],
  events: [],
  latency: [],
  usage: {},
};

function post(responses: Array<number | Error>) {
  const fetchImpl = vi.fn<typeof fetch>(() => {
    const next = responses.shift() ?? 500;
    return next instanceof Error
      ? Promise.reject(next)
      : Promise.resolve(new Response('{}', { status: next }));
  });
  const sleep = vi.fn(() => Promise.resolve());
  const result = postCallLog({
    apiBaseUrl: 'http://api.test',
    secret: 's3cret',
    callId: 'c1',
    log,
    logger: silentLogger,
    fetchImpl,
    sleep,
  });
  return { result, fetchImpl, sleep };
}

describe('postCallLog', () => {
  it('posts the log with the shared secret', async () => {
    const { result, fetchImpl } = post([200]);
    expect(await result).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://api.test/internal/calls/c1/log');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)[INTERNAL_SECRET_HEADER]).toBe('s3cret');
    expect(JSON.parse(init?.body as string)).toEqual(log);
  });

  it('retries a network failure and a 5xx, backing off, until it lands', async () => {
    const { result, fetchImpl, sleep } = post([new TypeError('fetch failed'), 503, 200]);
    expect(await result).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[1_000], [2_000]]);
  });

  it('does not retry an answer that says the log itself is wrong', async () => {
    const { result, fetchImpl } = post([400]);
    expect(await result).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('gives up after four attempts without throwing', async () => {
    const { result, fetchImpl } = post([500, 500, 500, 500, 200]);
    expect(await result).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});
