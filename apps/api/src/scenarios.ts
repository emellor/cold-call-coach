// The scenario catalog: the files in scenarios/ are validated at boot and
// upserted into the `scenarios` table, which the routes then read. The product
// and rubrics have no table (PLAN.md §10); they are held in memory.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type Difficulty,
  ScenarioCatalog,
  ScenarioSpec,
  type ScenarioSummary,
} from '@ccc/contracts';
import { desc, eq, sql } from 'drizzle-orm';
import type { Db } from './db/client.ts';
import { scenarios } from './db/schema.ts';

export class ScenarioFilesError extends Error {
  override name = 'ScenarioFilesError';
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new ScenarioFilesError(
      `${path}: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    );
  }
}

const jsonFiles = async (dir: string) =>
  (await readdir(dir)).filter((file) => file.endsWith('.json')).sort();

/**
 * Reads and validates everything in `dir`: every `*.json` except `product.json`
 * is a scenario, and `rubrics/*.json` are rubrics. Throws a ScenarioFilesError
 * naming each problem, so a bad edit stops the API at boot rather than a call.
 */
export async function readScenarioCatalog(dir: string): Promise<ScenarioCatalog> {
  const scenarioFiles = (await jsonFiles(dir)).filter((file) => file !== 'product.json');
  const rubricFiles = await jsonFiles(join(dir, 'rubrics'));
  const input = {
    product: await readJson(join(dir, 'product.json')),
    rubrics: await Promise.all(rubricFiles.map((f) => readJson(join(dir, 'rubrics', f)))),
    scenarios: await Promise.all(scenarioFiles.map((f) => readJson(join(dir, f)))),
  };

  const parsed = ScenarioCatalog.safeParse(input);
  if (!parsed.success) {
    const fileFor = (path: PropertyKey[]) => {
      const [kind, index] = path;
      if (kind === 'product') return 'product.json';
      if (kind === 'rubrics') return `rubrics/${rubricFiles[Number(index)]}`;
      return scenarioFiles[Number(index)] ?? 'scenarios';
    };
    const problems = parsed.error.issues.map(
      (i) => `  - ${fileFor(i.path)}: ${i.path.slice(2).join('.') || '(file)'} ${i.message}`,
    );
    throw new ScenarioFilesError([`Invalid files in ${dir}:`, ...problems].join('\n'));
  }

  const misnamed = parsed.data.scenarios.flatMap((s, i) =>
    scenarioFiles[i] === `${s.id}.json` ? [] : [`  - ${scenarioFiles[i]} holds id "${s.id}"`],
  );
  if (misnamed.length) {
    throw new ScenarioFilesError(
      ['Each scenario file must be named after its id:', ...misnamed].join('\n'),
    );
  }
  return parsed.data;
}

/**
 * Upserts scenarios by (id, version). A row is rewritten only when its spec
 * changed, so `updated_at` says when the stored scenario last changed.
 */
export async function syncScenarios(db: Db, specs: readonly ScenarioSpec[]): Promise<void> {
  if (!specs.length) return;
  await db
    .insert(scenarios)
    .values(
      specs.map((s) => ({
        id: s.id,
        version: s.version,
        title: s.title,
        difficulty: s.difficulty,
        spec: s,
      })),
    )
    .onConflictDoUpdate({
      target: [scenarios.id, scenarios.version],
      set: {
        title: sql`excluded.title`,
        difficulty: sql`excluded.difficulty`,
        spec: sql`excluded.spec`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`${scenarios.spec} IS DISTINCT FROM excluded.spec`,
    });
}

export interface ScenarioStoreLogger {
  warn(obj: object, msg: string): void;
}

/**
 * The newest version of every stored scenario whose spec still validates.
 * A row written by an older schema is skipped with a warning rather than
 * breaking the whole list.
 */
export async function latestScenarios(db: Db, log: ScenarioStoreLogger): Promise<ScenarioSpec[]> {
  const rows = await db
    .selectDistinctOn([scenarios.id])
    .from(scenarios)
    .orderBy(scenarios.id, desc(scenarios.version));
  return rows.flatMap((row) => {
    const parsed = ScenarioSpec.safeParse(row.spec);
    if (parsed.success) return [parsed.data];
    log.warn(
      { scenarioId: row.id, version: row.version, issues: parsed.error.issues },
      'stored scenario no longer validates; leaving it out',
    );
    return [];
  });
}

/** The newest version of one scenario, or undefined if there is none (or it no longer validates). */
export async function latestScenario(db: Db, id: string): Promise<ScenarioSpec | undefined> {
  const [row] = await db
    .select({ spec: scenarios.spec })
    .from(scenarios)
    .where(eq(scenarios.id, id))
    .orderBy(desc(scenarios.version))
    .limit(1);
  if (!row) return undefined;
  const parsed = ScenarioSpec.safeParse(row.spec);
  if (!parsed.success) throw new Error(`stored scenario ${id} no longer validates`);
  return parsed.data;
}

const DIFFICULTY_ORDER: Record<Difficulty, number> = { easy: 0, medium: 1, hard: 2 };

/** What the picker shows. The private facts and thresholds never leave the server. */
export function toSummary(s: ScenarioSpec): ScenarioSummary {
  return {
    id: s.id,
    version: s.version,
    title: s.title,
    difficulty: s.difficulty,
    winCondition: s.winCondition,
    prospect: { name: s.prospect.name, role: s.prospect.role, company: s.prospect.company },
  };
}

export const byDifficulty = (a: ScenarioSpec, b: ScenarioSpec): number =>
  DIFFICULTY_ORDER[a.difficulty] - DIFFICULTY_ORDER[b.difficulty] || a.title.localeCompare(b.title);
