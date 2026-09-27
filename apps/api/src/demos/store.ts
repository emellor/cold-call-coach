// Demo calls in Postgres: a batch is queued here, the agent claims them one at
// a time and posts each finished call back, and the web lists and plays them.
import { randomUUID } from 'node:crypto';
import {
  type DemoDetail,
  type DemoJob,
  type DemoResultRequest,
  type DemoStatus,
  type DemoSummary,
  ScenarioSpec,
} from '@ccc/contracts';
import { demoDurationMs, demoPlan } from '@ccc/core';
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { demoTurns, demos, scenarios } from '../db/schema.ts';

/** How long a claim holds a demo before another claim may take it over. */
export const CLAIM_LEASE_MINUTES = 15;
/** A demo that fails this many times stays failed until the rep retries it. */
export const MAX_ATTEMPTS = 3;

const GAVE_UP = `The agent stopped answering while writing this demo, ${MAX_ATTEMPTS} times.`;

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

/** How many demos are waiting or being written. */
export async function demosInProgress(db: Db): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(demos)
    .where(inArray(demos.status, ['queued', 'generating']));
  return row?.n ?? 0;
}

/**
 * Claims the next demo to write: the oldest queued, or one whose claim is older
 * than the lease (its agent died mid-demo). One that has run out of attempts is
 * marked failed instead.
 */
export async function claimDemo(db: Db): Promise<DemoJob | null> {
  const stale = sql`${demos.status} = 'generating' AND ${demos.claimedAt} < now() - make_interval(mins => ${CLAIM_LEASE_MINUTES})`;
  await db
    .update(demos)
    .set({ status: 'failed', error: GAVE_UP, updatedAt: sql`now()` })
    .where(and(stale, sql`${demos.attempts} >= ${MAX_ATTEMPTS}`));
  const claimed = await db.execute<{ id: string; scenario_id: string; angle: string }>(sql`
    UPDATE demos
       SET status = 'generating', claimed_at = now(), attempts = attempts + 1, updated_at = now()
     WHERE id = (
       SELECT id FROM demos
        WHERE status = 'queued' OR (${stale})
        ORDER BY created_at, position
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
    RETURNING id, scenario_id, angle`);
  const row = claimed.rows[0];
  return row ? { id: row.id, scenarioId: row.scenario_id, angle: row.angle } : null;
}

/** Stores a finished demo, lines and audio, replacing any earlier try. False if there is no such demo. */
export async function saveDemo(db: Db, id: string, result: DemoResultRequest): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(demos)
      .set({
        status: 'ready',
        error: null,
        scenarioVersion: result.scenarioVersion,
        title: result.title,
        summary: result.summary,
        lessons: result.lessons,
        outcome: result.outcome,
        outcomeDetail: result.outcomeDetail,
        durationMs: demoDurationMs(result.turns.map((t) => t.audioMs)),
        costUsd: result.costUsd,
        updatedAt: sql`now()`,
      })
      .where(eq(demos.id, id))
      .returning({ id: demos.id });
    if (!updated.length) return false;
    await tx.delete(demoTurns).where(eq(demoTurns.demoId, id));
    await tx.insert(demoTurns).values(
      result.turns.map((turn) => ({
        demoId: id,
        idx: turn.idx,
        speaker: turn.speaker,
        text: turn.text,
        technique: turn.technique,
        note: turn.note,
        interest: turn.interest,
        patience: turn.patience,
        audio: turn.audio === null ? null : Buffer.from(turn.audio, 'base64'),
        audioMs: turn.audio === null ? null : turn.audioMs,
      })),
    );
    return true;
  });
}

/**
 * The agent couldn't write a demo. It goes back in the queue for another try,
 * or, once it has had MAX_ATTEMPTS, stays failed with the reason. Null if
 * there is no such demo.
 */
export async function failDemo(db: Db, id: string, error: string): Promise<DemoStatus | null> {
  const [row] = await db
    .update(demos)
    .set({
      status: sql`CASE WHEN ${demos.attempts} >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'queued' END`,
      claimedAt: null,
      error,
      updatedAt: sql`now()`,
    })
    .where(eq(demos.id, id))
    .returning({ status: demos.status });
  return row?.status ?? null;
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

/** Who each demo called, from the version it used, or the newest one before it has run. */
async function prospectsFor(db: Db, rows: readonly DemoRow[]) {
  const ids = [...new Set(rows.map((r) => r.scenarioId))];
  if (!ids.length) return () => null;
  const stored = await db
    .select({ id: scenarios.id, version: scenarios.version, spec: scenarios.spec })
    .from(scenarios)
    .where(inArray(scenarios.id, ids))
    .orderBy(asc(scenarios.id), desc(scenarios.version));
  return (row: DemoRow): DemoSummary['prospect'] => {
    const match =
      stored.find((s) => s.id === row.scenarioId && s.version === row.scenarioVersion) ??
      stored.find((s) => s.id === row.scenarioId);
    const spec = ScenarioSpec.safeParse(match?.spec);
    if (!spec.success) return null;
    const { name, role, company } = spec.data.prospect;
    return { name, role, company, difficulty: spec.data.difficulty };
  };
}

const summaryOf = (row: DemoRow, prospect: DemoSummary['prospect']): DemoSummary => ({
  id: row.id,
  position: row.position,
  status: row.status,
  angle: row.angle,
  title: row.title,
  prospect,
  outcome: row.outcome,
  durationMs: row.durationMs,
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

/** One demo with its lines (audio left out: each line's is fetched on its own), or null. */
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
      interest: demoTurns.interest,
      patience: demoTurns.patience,
      audioMs: demoTurns.audioMs,
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

/** One line's MP3, or null if the demo, the line or its audio doesn't exist. */
export async function demoAudio(db: Db, id: string, idx: number): Promise<Buffer | null> {
  const [row] = await db
    .select({ audio: demoTurns.audio })
    .from(demoTurns)
    .where(and(eq(demoTurns.demoId, id), eq(demoTurns.idx, idx), isNotNull(demoTurns.audio)));
  return row?.audio ?? null;
}
