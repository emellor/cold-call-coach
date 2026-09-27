import { APIError } from '@anthropic-ai/sdk';
import type { DemoJob, DemoResultRequest } from '@ccc/contracts';
import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '../test/fixtures.ts';
import { demoQueue } from './api.ts';
import { mp3Ms } from './speech.ts';
import { describeDemoFailure, startDemoWorker } from './worker.ts';

const JOB: DemoJob = {
  id: '7b0a4e2c-2b1f-4f55-9a0c-6d3f1c1e8a10',
  scenarioId: 'medium-finance-director',
  angle: 'Lead with cost visibility.',
};
const RESULT = { title: 'A demo' } as DemoResultRequest;
const logger = { ...silentLogger, error: vi.fn() };

/** A queue that hands out `jobs` in turn, then nothing. */
function queueOf(jobs: Array<DemoJob | Error>) {
  const left = [...jobs];
  return {
    claim: vi.fn(() => {
      const next = left.shift();
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next ?? null);
    }),
    post: vi.fn(() => Promise.resolve()),
    fail: vi.fn(() => Promise.resolve()),
  };
}

/** Runs the worker until it has claimed `claims` times, then stops it. */
async function run(
  queue: ReturnType<typeof queueOf>,
  write: (job: DemoJob) => Promise<DemoResultRequest>,
  claims: number,
) {
  // A real (if instant) timer: resolving at once would never let the timers below run.
  const sleep = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const worker = startDemoWorker({ queue, write, logger, sleep });
  await vi.waitFor(() => expect(queue.claim.mock.calls.length).toBeGreaterThanOrEqual(claims));
  worker.stop();
  await worker.done;
  return { sleep };
}

describe('startDemoWorker', () => {
  it('writes each demo it claims and posts it back, resting when there is nothing to do', async () => {
    const queue = queueOf([JOB]);
    const write = vi.fn(() => Promise.resolve(RESULT));
    const { sleep } = await run(queue, write, 2);
    expect(write).toHaveBeenCalledWith(JOB);
    expect(queue.post).toHaveBeenCalledWith(JOB.id, RESULT);
    expect(queue.fail).not.toHaveBeenCalled();
    expect(sleep).toHaveBeenCalled();
  });

  it('reports a demo it could not write, in words, and carries on', async () => {
    const queue = queueOf([JOB, new Error('API down'), JOB]);
    const write = vi
      .fn<(job: DemoJob) => Promise<DemoResultRequest>>()
      .mockRejectedValueOnce(new Error('Cartesia answered 402: out of credits'))
      .mockResolvedValueOnce(RESULT);
    await run(queue, write, 3);
    expect(queue.fail).toHaveBeenCalledWith(JOB.id, 'Cartesia answered 402: out of credits');
    expect(queue.post).toHaveBeenCalledWith(JOB.id, RESULT);
  });
});

describe('describeDemoFailure', () => {
  it("names Claude's failures the way a call does", () => {
    const rejected = APIError.generate(
      401,
      { error: { type: 'x', message: 'no' } },
      'no',
      new Headers(),
    );
    expect(describeDemoFailure(rejected)).toContain('ANTHROPIC_API_KEY');
    expect(describeDemoFailure(new Error('plain'))).toBe('plain');
  });
});

describe('demoQueue', () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const urlOf = (input: string | URL | Request): string =>
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  it('claims, posts and fails with the secret, and says what the API answered', async () => {
    const fetchImpl = vi.fn<typeof fetch>((input) =>
      Promise.resolve(
        urlOf(input).endsWith('/claim')
          ? json(200, { job: JOB })
          : urlOf(input).endsWith('/failed')
            ? json(404, { error: 'No such demo call.' })
            : new Response(null, { status: 204 }),
      ),
    );
    const queue = demoQueue({ apiBaseUrl: 'http://api', secret: 's3cret', fetchImpl });
    expect(await queue.claim()).toEqual(JOB);
    await queue.post(JOB.id, RESULT);
    await expect(queue.fail(JOB.id, 'boom')).rejects.toThrow(
      'POST /internal/demos/7b0a4e2c-2b1f-4f55-9a0c-6d3f1c1e8a10/failed answered 404: {"error":"No such demo call."}',
    );
    const [url, init] = fetchImpl.mock.calls[1]!;
    expect(url).toBe(`http://api/internal/demos/${JOB.id}/result`);
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'x-internal-secret': 's3cret', 'content-type': 'application/json' },
      body: JSON.stringify(RESULT),
    });
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({
      headers: { 'x-internal-secret': 's3cret' },
    });
  });
});

describe('mp3Ms', () => {
  it('reads a line’s length from its size at 64 kbit/s', () => {
    expect(mp3Ms(8_000)).toBe(1_000);
    expect(mp3Ms(12_345)).toBe(1_543);
  });
});
