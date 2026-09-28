// Demo calls in Postgres: a batch, or one demo from the rep's brief, is queued
// here, the API's DemoQueue claims and writes them a few at a time, and the web
// lists and reads them.
import { randomUUID } from 'node:crypto';
import {
  type DemoDetail,
  type DemoOutcome,
  DemoProspect,
  type DemoSummary,
  ScenarioSpec,
} from '@ccc/contracts';
import { demoPlan } from '@ccc/core';
import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { demoTurns, demos, scenarios } from '../db/schema.ts';
import type { WrittenDemo } from './writer.ts';

/** A demo a restart interrupted goes back in the queue this many times at most. */
export const MAX_ATTEMPTS = 2;

const INTERRUPTED = 'The API restarted while writing this demo. Retry it.';

/** A demo to write: to one of the stored prospects with an approach, or from a brief. */
export type DemoJob =
  | { id: string; kind: 'scenario'; scenarioId: string; angle: string }
  | { id: string; kind: 'brief'; brief: string };

/** Queues `count` demos across the given prospects, as one batch. Returns how many. */
export async function queueDemos(
  db: Db,
  scenarioIds: readonly string[],
  count: number,
): Promise<number> {
  const plan = demoPlan(count, scenarioIds);
  if (!plan.length) return 0;
  const batchId = randomUUID();
  await db.insert(demos).values(
    plan.map((item, i) => ({
      batchId,
      position: i + 1,
      scenarioId: item.scenarioId,
      angle: item.angle,
    })),
  );
  return plan.length;
}

/** Queues one demo from the rep's brief, as a batch of its own. Returns its id. */
export async function queueBriefDemo(db: Db, brief: string): Promise<string> {
  const [row] = await db
    .insert(demos)
    .values({ batchId: randomUUID(), position: 1, brief })
    .returning({ id: demos.id });
  if (!row) throw new Error('The demo call was not queued.');
  return row.id;
}

/** How many demos are waiting or being written. */
export async function demosInProgress(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(demos)
    .where(inArray(demos.status, ['queued', 'generating']));
  return row?.n ?? 0;
}

/**
 * Claims the next queued demo for writing, or null when none is waiting. A
 * demo from a brief goes first: the rep is waiting on that one page for it,
 * while a batch carries on in the background.
 */
export async function claimDemo(db: Db): Promise<DemoJob | null> {
  const claimed = await db.execute<{
    id: string;
    scenario_id: string | null;
    angle: string | null;
    brief: string | null;
  }>(sql`
    UPDATE demos
       SET status = 'generating', claimed_at = now(), attempts = attempts + 1, updated_at = now()
     WHERE id = (
       SELECT id FROM demos
        WHERE status = 'queued'
        ORDER BY brief IS NULL, created_at, position
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
    RETURNING id, scenario_id, angle, brief`);
  const row = claimed.rows[0];
  if (!row) return null;
  if (row.brief !== null) return { id: row.id, kind: 'brief', brief: row.brief };
  // demos_source_check: a demo without a brief has a prospect and an approach.
  return { id: row.id, kind: 'scenario', scenarioId: row.scenario_id!, angle: row.angle! };
}

/** Stores a written demo and its lines, replacing any earlier try. False if there is no such demo. */
export async function saveDemo(
  db: Db,
  id: string,
  demo: WrittenDemo & { scenarioVersion: number | null; outcome: DemoOutcome },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(demos)
      .set({
        status: 'ready',
        claimedAt: null,
        error: null,
        scenarioVersion: demo.scenarioVersion,
        prospect: demo.prospect ?? null,
        title: demo.title,
        summary: demo.summary,
        lessons: demo.lessons,
        outcome: demo.outcome,
        outcomeDetail: demo.meeting,
        costUsd: demo.costUsd,
        updatedAt: sql`now()`,
      })
      .where(eq(demos.id, id))
      .returning({ id: demos.id });
    if (!updated.length) return false;
    await tx.delete(demoTurns).where(eq(demoTurns.demoId, id));
    await tx.insert(demoTurns).values(
      demo.lines.map((line, idx) => ({
        demoId: id,
        idx,
        speaker: line.speaker,
        text: line.text,
        technique: line.technique,
        note: line.note,
      })),
    );
    return true;
  });
}

/**
 * The demo couldn't be written. It stays failed, with the reason, until the rep
 * retries it: a failure after Claude answered has already been paid for, so it
 * is never retried automatically.
 */
export async function failDemo(db: Db, id: string, error: string): Promise<void> {
  await db
    .update(demos)
    .set({ status: 'failed', claimedAt: null, error, updatedAt: sql`now()` })
    .where(eq(demos.id, id));
}

/**
 * At boot: demos a restart left half-written go back in the queue, unless a
 * restart has already interrupted them MAX_ATTEMPTS times. Returns how many
 * went back.
 */
export async function requeueInterrupted(db: Db): Promise<number> {
  const rows = await db
    .update(demos)
    .set({
      status: sql`CASE WHEN ${demos.attempts} >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'queued' END`,
      error: sql`CASE WHEN ${demos.attempts} >= ${MAX_ATTEMPTS} THEN ${INTERRUPTED} ELSE NULL END`,
      claimedAt: null,
      updatedAt: sql`now()`,
    })
    .where(eq(demos.status, 'generating'))
    .returning({ status: demos.status });
  return rows.filter((r) => r.status === 'queued').length;
}

/** Puts every failed demo back in the queue with fresh attempts. Returns how many. */
export async function retryFailedDemos(db: Db): Promise<number> {
  const rows = await db
    .update(demos)
    .set({ status: 'queued', attempts: 0, claimedAt: null, error: null, updatedAt: sql`now()` })
    .where(eq(demos.status, 'failed'))
    .returning({ id: demos.id });
  return rows.length;
}

type DemoRow = typeof demos.$inferSelect;

/**
 * Who each demo called: for a demo from a brief, whoever Claude wrote (nobody
 * until it has); otherwise the prospect, from the version the demo used, or
 * the newest one before it has run. The shipped prospects are all women.
 */
async function prospectsFor(db: Db, rows: readonly DemoRow[]) {
  const ids = [...new Set(rows.flatMap((r) => (r.scenarioId === null ? [] : [r.scenarioId])))];
  const stored = ids.length
    ? await db
        .select({ id: scenarios.id, version: scenarios.version, spec: scenarios.spec })
        .from(scenarios)
        .where(inArray(scenarios.id, ids))
        .orderBy(asc(scenarios.id), desc(scenarios.version))
    : [];
  return (row: DemoRow): DemoSummary['prospect'] => {
    if (row.scenarioId === null) {
      const written = DemoProspect.safeParse(row.prospect);
      return written.success ? written.data : null;
    }
    const match =
      stored.find((s) => s.id === row.scenarioId && s.version === row.scenarioVersion) ??
      stored.find((s) => s.id === row.scenarioId);
    const spec = ScenarioSpec.safeParse(match?.spec);
    if (!spec.success) return null;
    const { name, role, company } = spec.data.prospect;
    return {
      name,
      role,
      company,
      difficulty: spec.data.difficulty,
      gender: 'female',
      locale: spec.data.locale,
    };
  };
}

const summaryOf = (row: DemoRow, prospect: DemoSummary['prospect']): DemoSummary => ({
  id: row.id,
  position: row.position,
  status: row.status,
  angle: row.angle,
  brief: row.brief,
  title: row.title,
  prospect,
  outcome: row.outcome,
  error: row.error,
  createdAt: row.createdAt.toISOString(),
});

/** Every demo: the newest batch first, each batch in order. */
export async function listDemos(db: Db): Promise<DemoSummary[]> {
  const rows = await db
    .select()
    .from(demos)
    .orderBy(desc(demos.createdAt), desc(demos.batchId), asc(demos.position));
  const prospect = await prospectsFor(db, rows);
  return rows.map((row) => summaryOf(row, prospect(row)));
}

/** One demo with its lines, or null. */
export async function demoDetail(db: Db, id: string): Promise<DemoDetail | null> {
  const [row] = await db.select().from(demos).where(eq(demos.id, id));
  if (!row) return null;
  const prospect = await prospectsFor(db, [row]);
  const turns = await db
    .select({
      idx: demoTurns.idx,
      speaker: demoTurns.speaker,
      text: demoTurns.text,
      technique: demoTurns.technique,
      note: demoTurns.note,
    })
    .from(demoTurns)
    .where(eq(demoTurns.demoId, id))
    .orderBy(asc(demoTurns.idx));
  return {
    ...summaryOf(row, prospect(row)),
    summary: row.summary,
    lessons: row.lessons ?? [],
    outcomeDetail: row.outcomeDetail,
    turns,
    costUsd: row.costUsd,
  };
}
