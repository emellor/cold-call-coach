// Reading and writing a call's log, transcript and review.
import {
  type CallDetail,
  type CallLog,
  type CallReview,
  type CallSummary,
  ProspectState,
  ReviewResult,
  TimedWord,
} from '@ccc/contracts';
import { type MetricTurn, computeMetrics } from '@ccc/core';
import { type SQL, and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.ts';
import { LOCAL_USER_ID, calls, events, reviews, scenarios, turns } from '../db/schema.ts';

/** A stored call's cost for the live lanes: the sum of what could be priced. */
function liveCost(usage: CallLog['usage']): number | null {
  const priced = Object.values(usage).flatMap((lane) =>
    lane?.costUsd === null || lane === undefined ? [] : [lane.costUsd],
  );
  return priced.length ? priced.reduce((a, b) => a + b, 0) : null;
}

/**
 * Replaces the call's log with `log` in one transaction: the call's outcome
 * and timings, its turns and its events. Posting the same log twice leaves the
 * same rows. False if there is no such call.
 */
export async function saveCallLog(db: Db, callId: string, log: CallLog): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [call] = await tx
      .select({ id: calls.id })
      .from(calls)
      .where(eq(calls.id, callId))
      .for('update');
    if (!call) return false;

    await tx
      .update(calls)
      .set({
        status: 'ended',
        outcome: log.outcome,
        outcomeReason: log.reason ?? null,
        connectedAt: log.connectedAt ? new Date(log.connectedAt) : null,
        endedAt: new Date(log.endedAt),
        durationMs: log.durationMs,
        latency: log.latency,
        usage: log.usage,
        costUsd: liveCost(log.usage),
      })
      .where(eq(calls.id, callId));

    await tx.delete(turns).where(eq(turns.callId, callId));
    if (log.turns.length) {
      await tx.insert(turns).values(
        log.turns.map((t) => ({
          callId,
          idx: t.idx,
          speaker: t.speaker,
          text: t.text,
          startMs: t.startMs,
          endMs: t.endMs,
          words: t.words,
          interrupted: t.interrupted,
          stateAfter: t.stateAfter,
        })),
      );
    }
    await tx.delete(events).where(eq(events.callId, callId));
    if (log.events.length) {
      await tx
        .insert(events)
        .values(log.events.map((e) => ({ callId, tMs: e.tMs, kind: e.kind, payload: e.payload })));
    }
    return true;
  });
}

const Words = z.array(TimedWord).nullable();

/** The call's turns in order, shaped for the metrics (stored word timings included). */
export async function metricTurns(db: Db, callId: string): Promise<MetricTurn[]> {
  const rows = await db
    .select()
    .from(turns)
    .where(eq(turns.callId, callId))
    .orderBy(asc(turns.idx));
  return rows.map((t) => ({
    speaker: t.speaker,
    text: t.text,
    startMs: t.startMs,
    endMs: t.endMs,
    interrupted: t.interrupted,
    words: Words.safeParse(t.words).data ?? null,
  }));
}

const summaryColumns = {
  id: calls.id,
  startedAt: calls.startedAt,
  mode: calls.mode,
  status: calls.status,
  outcome: calls.outcome,
  outcomeReason: calls.outcomeReason,
  durationMs: calls.durationMs,
  scenarioId: calls.scenarioId,
  scenarioVersion: calls.scenarioVersion,
  title: scenarios.title,
  difficulty: scenarios.difficulty,
  prospectName: sql<string>`${scenarios.spec} -> 'prospect' ->> 'name'`,
  reviewStatus: reviews.status,
  overallScore: sql<number | null>`(${reviews.result} ->> 'overallScore')::int`,
};

const toSummary = (row: SummaryRow): CallSummary => ({
  id: row.id,
  startedAt: row.startedAt.toISOString(),
  mode: row.mode,
  status: row.status,
  outcome: row.outcome,
  durationMs: row.durationMs,
  scenario: {
    id: row.scenarioId,
    version: row.scenarioVersion,
    title: row.title,
    difficulty: row.difficulty,
    prospectName: row.prospectName,
  },
  overallScore: row.overallScore,
  reviewStatus: row.reviewStatus,
});

/** The local user's calls matching `where`, newest first, with scenario and review summaries. */
function selectSummaries(db: Db, where: SQL, limit: number) {
  return db
    .select(summaryColumns)
    .from(calls)
    .innerJoin(
      scenarios,
      and(eq(scenarios.id, calls.scenarioId), eq(scenarios.version, calls.scenarioVersion)),
    )
    .leftJoin(reviews, eq(reviews.callId, calls.id))
    .where(and(eq(calls.userId, LOCAL_USER_ID), where))
    .orderBy(desc(calls.startedAt))
    .limit(limit);
}

type SummaryRow = Awaited<ReturnType<typeof selectSummaries>>[number];

/** The local user's calls, newest first. */
export async function listCalls(db: Db, limit = 100): Promise<CallSummary[]> {
  const rows = await selectSummaries(db, sql`true`, limit);
  return rows.map(toSummary);
}

export async function getCallDetail(db: Db, callId: string): Promise<CallDetail | undefined> {
  const [row] = await selectSummaries(db, eq(calls.id, callId), 1);
  if (!row) return undefined;

  const turnRows = await db
    .select()
    .from(turns)
    .where(eq(turns.callId, callId))
    .orderBy(asc(turns.idx));
  const [reviewRow] = await db.select().from(reviews).where(eq(reviews.callId, callId));

  let review: CallReview | null = null;
  if (reviewRow) {
    const result = reviewRow.result === null ? null : ReviewResult.safeParse(reviewRow.result);
    review = {
      status: reviewRow.status,
      result: result?.success ? result.data : null,
      error:
        result && !result.success
          ? 'This review was stored in an older format; rerun it.'
          : reviewRow.error,
      model: reviewRow.model,
      costUsd: reviewRow.costUsd,
      updatedAt: reviewRow.updatedAt.toISOString(),
    };
  }

  return {
    call: toSummary(row),
    outcomeReason: row.outcomeReason,
    turns: turnRows.map((t) => ({
      idx: t.idx,
      speaker: t.speaker,
      text: t.text,
      startMs: t.startMs,
      endMs: t.endMs,
      interrupted: t.interrupted,
      stateAfter: ProspectState.nullable().safeParse(t.stateAfter).data ?? null,
    })),
    // Measured once the log is in; the same numbers the review was given.
    metrics:
      row.status === 'ended'
        ? computeMetrics(await metricTurns(db, callId), row.durationMs ?? 0)
        : null,
    review,
  };
}
