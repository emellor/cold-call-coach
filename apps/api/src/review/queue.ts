// The review job: an in-process queue (PLAN.md §8.4). A call's review is
// queued when its log arrives (or on rerun), then: metrics from the turns,
// one Claude call, every quote checked against the transcript, and the result
// stored with its model, rubric version and cost.
import { type ReviewStatus, type ScenarioCatalog, ScenarioSpec } from '@ccc/contracts';
import { computeMetrics, controlsUsed, finalizeReview } from '@ccc/core';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { metricTurns } from '../calls/store.ts';
import type { Db } from '../db/client.ts';
import { calls, events, reviews, scenarios } from '../db/schema.ts';
import type { Reviewer } from './reviewer.ts';

export interface QueueLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export const NO_REVIEWER_MESSAGE =
  'Reviews are off: ANTHROPIC_API_KEY is not set on the API. Add it to .env and rerun the review.';

class Skip extends Error {}

export class ReviewQueue {
  readonly #db: Db;
  readonly #catalog: ScenarioCatalog;
  readonly #reviewer: Reviewer | null;
  readonly #log: QueueLogger;
  readonly #waiting: string[] = [];
  #running: Promise<void> | null = null;

  constructor(options: {
    db: Db;
    catalog: ScenarioCatalog;
    reviewer: Reviewer | null;
    logger: QueueLogger;
  }) {
    this.#db = options.db;
    this.#catalog = options.catalog;
    this.#reviewer = options.reviewer;
    this.#log = options.logger;
  }

  /** Marks the call's review pending and queues it; a second request while queued is a no-op. */
  async enqueue(callId: string): Promise<ReviewStatus> {
    await this.#db
      .insert(reviews)
      .values({ callId, status: 'pending' })
      .onConflictDoUpdate({
        target: reviews.callId,
        set: { status: 'pending', error: null, updatedAt: sql`now()` },
      });
    if (!this.#waiting.includes(callId)) this.#waiting.push(callId);
    this.#running ??= this.#drain();
    return 'pending';
  }

  /** Re-queues reviews a restart left unfinished. */
  async resumeUnfinished(): Promise<number> {
    const stuck = await this.#db
      .select({ callId: reviews.callId })
      .from(reviews)
      .where(inArray(reviews.status, ['pending', 'running']));
    for (const { callId } of stuck) await this.enqueue(callId);
    return stuck.length;
  }

  /** Resolves once the queue is empty (tests). */
  async idle(): Promise<void> {
    while (this.#running) await this.#running;
  }

  async #drain(): Promise<void> {
    try {
      for (let callId = this.#waiting.shift(); callId; callId = this.#waiting.shift()) {
        await this.#review(callId);
      }
    } finally {
      this.#running = null;
    }
  }

  async #set(callId: string, values: Partial<typeof reviews.$inferInsert>) {
    await this.#db
      .update(reviews)
      .set({ ...values, updatedAt: sql`now()` })
      .where(eq(reviews.callId, callId));
  }

  async #review(callId: string): Promise<void> {
    const started = performance.now();
    try {
      await this.#set(callId, { status: 'running' });
      const input = await this.#load(callId);
      if (!this.#reviewer) throw new Error(NO_REVIEWER_MESSAGE);
      const outcome = await this.#reviewer(input.prompt);
      const { result, dropped } = finalizeReview(
        outcome.draft,
        input.prompt.turns,
        input.prompt.rubric.criteria.map((c) => c.key),
      );
      if (dropped.length) {
        this.#log.warn({ callId, dropped }, 'review quotes not found in the transcript; dropped');
      }
      await this.#set(callId, {
        status: 'ready',
        result,
        error: null,
        model: outcome.model,
        rubricId: input.prompt.rubric.id,
        rubricVersion: input.prompt.rubric.version,
        costUsd: outcome.costUsd,
      });
      this.#log.info(
        {
          callId,
          model: outcome.model,
          ms: Math.round(performance.now() - started),
          costUsd: outcome.costUsd,
          quotesDropped: dropped.length,
        },
        'review ready',
      );
    } catch (error) {
      if (error instanceof Skip) {
        await this.#set(callId, { status: 'skipped', error: error.message, result: null });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.#log.error({ err: error, callId }, 'review failed');
      await this.#set(callId, { status: 'failed', error: message }).catch(() => {});
    }
  }

  async #load(callId: string) {
    const [call] = await this.#db.select().from(calls).where(eq(calls.id, callId));
    if (!call) throw new Error(`No call ${callId}.`);
    if (call.connectedAt === null) {
      throw new Skip('She never picked up, so there is nothing to review.');
    }
    const transcript = await metricTurns(this.#db, callId);
    if (!transcript.some((t) => t.speaker === 'rep')) {
      throw new Skip('Nothing to review: you did not say anything on this call.');
    }
    const [stored] = await this.#db
      .select({ spec: scenarios.spec })
      .from(scenarios)
      .where(and(eq(scenarios.id, call.scenarioId), eq(scenarios.version, call.scenarioVersion)));
    const scenario = ScenarioSpec.parse(stored?.spec);
    const rubric = this.#catalog.rubrics.find((r) => r.id === scenario.rubricId);
    if (!rubric) throw new Error(`The rubric "${scenario.rubricId}" is not loaded.`);
    const controlEvents = await this.#db
      .select({ kind: events.kind, payload: events.payload })
      .from(events)
      .where(
        and(eq(events.callId, callId), inArray(events.kind, ['pause', 'resume', 'hint', 'rewind'])),
      )
      .orderBy(asc(events.tMs), asc(events.id));

    return {
      prompt: {
        rubric,
        scenario,
        product: this.#catalog.product,
        metrics: computeMetrics(transcript, call.durationMs ?? 0),
        outcome: call.outcome ?? 'ended_by_rep',
        outcomeReason: call.outcomeReason,
        turns: transcript.map((t) => ({ ...t, interrupted: t.interrupted ?? false })),
        controls: controlsUsed(controlEvents),
      },
    };
  }
}
