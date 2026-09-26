// Applies apps/api/migrations/NNNN_*.sql in filename order and records a
// SHA-256 per file. Editing a file after it has been applied is a hard error:
// add a new numbered migration instead.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { ConfigError, loadConfig, loadDotEnv } from '../config.ts';
import { migrationsDir } from '../paths.ts';

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;
/** Serialises concurrent runners (two deploys, or a deploy racing `pnpm db:migrate`). */
const ADVISORY_LOCK_KEY = 5_150_001;

export interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

export async function readMigrations(dir: string): Promise<MigrationFile[]> {
  const names = (await readdir(dir)).filter((n) => MIGRATION_FILE.test(n)).sort();
  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(join(dir, name), 'utf8');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    }),
  );
}

/** Runs on one client so that session state (search_path, the lock) applies throughout. */
export async function migrate(
  client: pg.ClientBase,
  dir: string,
  log: (line: string) => void = () => {},
): Promise<string[]> {
  const files = await readMigrations(dir);
  await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text        PRIMARY KEY,
        checksum   text        NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM schema_migrations',
    );
    const applied = new Map(rows.map((r) => [r.name, r.checksum]));
    const onDisk = new Set(files.map((f) => f.name));

    for (const [name] of applied) {
      if (!onDisk.has(name)) {
        throw new Error(`Migration ${name} has been applied but is missing from ${dir}.`);
      }
    }
    for (const file of files) {
      const checksum = applied.get(file.name);
      if (checksum !== undefined && checksum !== file.checksum) {
        throw new Error(
          `Migration ${file.name} was edited after it was applied. ` +
            'Applied migrations are immutable: revert the edit and add a new numbered migration.',
        );
      }
    }

    const ran: string[] = [];
    for (const file of files.filter((f) => !applied.has(f.name))) {
      await client.query('BEGIN');
      try {
        await client.query(file.sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
          file.name,
          file.checksum,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file.name} failed: ${(error as Error).message}`, {
          cause: error,
        });
      }
      log(`applied ${file.name}`);
      ran.push(file.name);
    }
    return ran;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig(process.env);
  const client = new pg.Client({ connectionString: config.DATABASE_URL });
  await client.connect();
  try {
    const ran = await migrate(client, migrationsDir, (line) => console.log(line));
    console.log(ran.length ? `${ran.length} migration(s) applied.` : 'Database is up to date.');
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof ConfigError ? error.message : error);
    process.exit(1);
  });
}
