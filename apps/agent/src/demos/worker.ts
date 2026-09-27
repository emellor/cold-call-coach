// The demo worker. It runs beside the LiveKit worker, in the agent's main
// process: asks the API for the next demo to write, writes it and posts it
// back, one at a time. The queue lives in the API, so a restart loses nothing:
// a demo it was writing is taken over once the API's lease runs out.
import { APIError as ClaudeAPIError } from '@anthropic-ai/sdk';
import type { DemoJob, DemoResultRequest } from '@ccc/contracts';
import { describeClaudeFailure } from '../failures.ts';
import type { DemoQueue } from './api.ts';

/** How long it waits when there's nothing to do, or after a failure. */
export const DEMO_IDLE_MS = 20_000;

export interface DemoWorkerLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface DemoWorker {
  stop(): void;
  /** Settles once the worker has stopped. */
  readonly done: Promise<void>;
}

/** A failure in words fit for the demos page. */
export function describeDemoFailure(error: unknown): string {
  if (
    error instanceof ClaudeAPIError ||
    (error instanceof Error && error.name === 'TimeoutError')
  ) {
    return describeClaudeFailure(error);
  }
  return error instanceof Error ? error.message : String(error);
}

const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref();
  });

export function startDemoWorker(options: {
  queue: DemoQueue;
  write: (job: DemoJob) => Promise<DemoResultRequest>;
  logger: DemoWorkerLogger;
  idleMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): DemoWorker {
  const { queue, write, logger, idleMs = DEMO_IDLE_MS, sleep = pause } = options;
  let stopped = false;

  const once = async (): Promise<void> => {
    let job: DemoJob | null;
    try {
      job = await queue.claim();
    } catch (error) {
      logger.warn({ err: error }, 'demo worker: could not ask the API for work');
      return sleep(idleMs);
    }
    if (!job) return sleep(idleMs);
    const started = performance.now();
    logger.info({ demoId: job.id, scenarioId: job.scenarioId }, 'demo call: writing');
    try {
      await queue.post(job.id, await write(job));
      logger.info(
        { demoId: job.id, ms: Math.round(performance.now() - started) },
        'demo call: posted',
      );
    } catch (error) {
      logger.error({ err: error, demoId: job.id }, 'demo call failed');
      await queue
        .fail(job.id, describeDemoFailure(error))
        .catch((e: unknown) => logger.warn({ err: e }, 'demo worker: could not report a failure'));
      await sleep(idleMs);
    }
  };

  const done = (async () => {
    while (!stopped) await once();
  })();
  return {
    stop: () => {
      stopped = true;
    },
    done,
  };
}
