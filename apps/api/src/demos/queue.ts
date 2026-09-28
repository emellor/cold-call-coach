// The demo calls' queue: in-process, like the reviews'. "Generate" puts a batch
// in Postgres, and a brief one demo; this writes them a few at a time, one
// Claude call each, and stores each transcript as it lands. A demo is tried once: a failure after
// Claude has answered has already been paid for, so it waits for the rep to
// retry it instead of spending again on its own.
import type { Db } from '../db/client.ts';
import { latestScenario } from '../scenarios.ts';
import { type DemoJob, claimDemo, failDemo, requeueInterrupted, saveDemo } from './store.ts';
import type { DemoWriter, WrittenDemo } from './writer.ts';

/** How many demos are written at once: a batch of 20 takes about ten minutes. */
export const DEMO_CONCURRENCY = 3;

export interface DemoQueueLogger {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export class DemoQueue {
  readonly #db: Db;
  readonly #writer: DemoWriter | null;
  readonly #log: DemoQueueLogger;
  readonly #concurrency: number;
  readonly #workers = new Set<Promise<void>>();

  constructor(options: {
    db: Db;
    /** Null without ANTHROPIC_API_KEY: nothing is written, and the routes say why. */
    writer: DemoWriter | null;
    logger: DemoQueueLogger;
    concurrency?: number;
  }) {
    this.#db = options.db;
    this.#writer = options.writer;
    this.#log = options.logger;
    this.#concurrency = options.concurrency ?? DEMO_CONCURRENCY;
  }

  /** Whether demos can be written at all. */
  get enabled(): boolean {
    return this.#writer !== null;
  }

  /** Starts writing whatever is queued, up to the concurrency limit. */
  kick(): void {
    const writer = this.#writer;
    if (!writer) return;
    while (this.#workers.size < this.#concurrency) {
      const worker: Promise<void> = this.#work(writer).finally(() => this.#workers.delete(worker));
      this.#workers.add(worker);
    }
  }

  /** At boot: demos a restart interrupted go back in the queue, then writing resumes. */
  async resumeUnfinished(): Promise<number> {
    const requeued = await requeueInterrupted(this.#db);
    this.kick();
    return requeued;
  }

  /** Resolves once nothing is being written (tests). */
  async idle(): Promise<void> {
    while (this.#workers.size) await Promise.all([...this.#workers]);
  }

  async #work(writer: DemoWriter): Promise<void> {
    try {
      for (let job = await claimDemo(this.#db); job; job = await claimDemo(this.#db)) {
        await this.#write(writer, job);
      }
    } catch (error) {
      // The queue itself failed (the database, most likely); the next kick picks up again.
      this.#log.error({ err: error }, 'demo queue stopped');
    }
  }

  async #write(writer: DemoWriter, job: DemoJob): Promise<void> {
    const started = performance.now();
    try {
      let written: WrittenDemo;
      let scenarioVersion: number | null = null;
      if (job.kind === 'brief') {
        written = await writer({ brief: job.brief });
      } else {
        const scenario = await latestScenario(this.#db, job.scenarioId);
        if (!scenario) {
          throw new Error('This prospect has been removed, so the call was not written.');
        }
        written = await writer({ scenario, angle: job.angle });
        scenarioVersion = scenario.version;
      }
      await saveDemo(this.#db, job.id, {
        ...written,
        scenarioVersion,
        // A brief can set an objective other than the meeting a prospect's demo books.
        outcome: job.kind === 'brief' ? 'objective_met' : 'meeting_booked',
      });
      this.#log.info(
        {
          demoId: job.id,
          lines: written.lines.length,
          costUsd: written.costUsd,
          ms: Math.round(performance.now() - started),
        },
        'demo call ready',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#log.error({ err: error, demoId: job.id }, 'demo call failed');
      await failDemo(this.#db, job.id, message).catch((err: unknown) =>
        this.#log.error({ err, demoId: job.id }, 'could not mark the demo call failed'),
      );
    }
  }
}
