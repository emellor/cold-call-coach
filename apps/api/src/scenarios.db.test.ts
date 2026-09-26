import { randomUUID } from 'node:crypto';
import type { ScenarioSpec } from '@ccc/contracts';
import { and, eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createDb } from './db/client.ts';
import { scenarios } from './db/schema.ts';
import { latestScenario, latestScenarios, syncScenarios } from './scenarios.ts';
import { testCatalog } from './test/catalog.ts';
import { databaseAvailable, testDatabaseUrl } from './test/db.ts';

const hasDb = await databaseAvailable();

describe.skipIf(!hasDb)('storing scenarios (real Postgres)', () => {
  const { pool, db } = createDb(testDatabaseUrl);
  // Unique ids keep this file's rows apart from the real scenarios and other runs.
  const prefix = `zz-sync-${randomUUID().slice(0, 8)}`;
  const base = testCatalog.scenarios[0]!;
  const spec = (suffix: string, version: number, title = base.title): ScenarioSpec => ({
    ...base,
    id: `${prefix}-${suffix}`,
    version,
    title,
  });
  const quietLog = { warn: vi.fn() };

  afterAll(async () => {
    await db.delete(scenarios).where(like(scenarios.id, `${prefix}-%`));
    await pool.end();
  });

  const row = async (id: string, version: number) => {
    const [found] = await db
      .select()
      .from(scenarios)
      .where(and(eq(scenarios.id, id), eq(scenarios.version, version)));
    return found;
  };

  it('inserts, leaves an unchanged spec alone, and rewrites a changed one', async () => {
    const first = spec('a', 1);
    await syncScenarios(db, [first]);
    const inserted = await row(first.id, 1);
    expect(inserted).toMatchObject({ title: base.title, difficulty: base.difficulty, spec: first });

    await syncScenarios(db, [first]);
    expect((await row(first.id, 1))?.updatedAt).toEqual(inserted?.updatedAt);

    const edited = spec('a', 1, 'Edited title');
    await syncScenarios(db, [edited]);
    const rewritten = await row(first.id, 1);
    expect(rewritten).toMatchObject({ title: 'Edited title', spec: edited });
    expect(rewritten!.updatedAt.getTime()).toBeGreaterThanOrEqual(inserted!.updatedAt.getTime());
  });

  it('keeps every version and serves the newest', async () => {
    const id = `${prefix}-b`;
    await syncScenarios(db, [spec('b', 1, 'First'), spec('b', 3, 'Third'), spec('b', 2, 'Second')]);
    expect((await latestScenario(db, id))?.title).toBe('Third');
    const listed = (await latestScenarios(db, quietLog)).filter((s) => s.id === id);
    expect(listed.map((s) => s.version)).toEqual([3]);
    expect(await row(id, 1)).toBeDefined();
  });

  it('leaves out a stored spec that no longer validates, with a warning', async () => {
    const id = `${prefix}-c`;
    await db
      .insert(scenarios)
      .values({ id, version: 1, title: 'Old shape', difficulty: 'easy', spec: { old: true } });
    const warn = vi.fn();
    expect((await latestScenarios(db, { warn })).some((s) => s.id === id)).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ scenarioId: id }),
      expect.stringContaining('no longer validates'),
    );
    await expect(latestScenario(db, id)).rejects.toThrow('no longer validates');
  });

  it('returns undefined for a scenario it has never stored', async () => {
    expect(await latestScenario(db, `${prefix}-missing`)).toBeUndefined();
  });
});
