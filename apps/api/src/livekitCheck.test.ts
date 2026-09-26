import { TwirpError } from 'livekit-server-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiveKitCheck, RETRY_MS, VERDICT_MS, WAIT_MS, isRejection } from './livekitCheck.ts';

const unauthorized = () => new TwirpError('Unauthorized', 'invalid token', 401);

describe('isRejection', () => {
  it('is LiveKit refusing the credentials, not LiveKit being unreachable', () => {
    expect(isRejection(unauthorized())).toBe(true);
    expect(isRejection(new TwirpError('Forbidden', 'no', 403))).toBe(true);
    expect(isRejection(new TwirpError('Bad Gateway', 'down', 502))).toBe(false);
    expect(isRejection(new TypeError('fetch failed'))).toBe(false);
  });
});

describe('LiveKitCheck', () => {
  afterEach(() => vi.useRealTimers());

  it('asks LiveKit once, and keeps the verdict for a minute', async () => {
    let now = 0;
    const probe = vi.fn(() => Promise.resolve());
    const check = new LiveKitCheck(probe, { now: () => now });
    expect(await check.auth()).toBe('ok');
    now += VERDICT_MS - 1;
    expect(await check.auth()).toBe('ok');
    expect(probe).toHaveBeenCalledTimes(1);
    now += 1;
    expect(await check.auth()).toBe('ok');
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('reports a refused key pair, and says so once, not on every health check', async () => {
    let now = 0;
    const onRejected = vi.fn();
    const check = new LiveKitCheck(() => Promise.reject(unauthorized()), {
      now: () => now,
      onRejected,
    });
    expect(await check.auth()).toBe('rejected');
    now += VERDICT_MS;
    expect(await check.auth()).toBe('rejected');
    expect(onRejected).toHaveBeenCalledTimes(1);
  });

  it('treats an unreachable LiveKit as unknown, and asks again sooner', async () => {
    let now = 0;
    const probe = vi.fn(() => Promise.reject(new TypeError('fetch failed')));
    const check = new LiveKitCheck(probe, { now: () => now });
    expect(await check.auth()).toBe('unknown');
    now += RETRY_MS;
    await check.auth();
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('never holds a health check up: a slow LiveKit reads as unknown until it answers', async () => {
    vi.useFakeTimers();
    let answer = () => {};
    const check = new LiveKitCheck(
      () =>
        new Promise<void>((_resolve, reject) => {
          answer = () => reject(unauthorized());
        }),
    );
    const first = check.auth();
    await vi.advanceTimersByTimeAsync(WAIT_MS);
    expect(await first).toBe('unknown');
    answer();
    expect(await check.auth()).toBe('rejected');
  });
});
