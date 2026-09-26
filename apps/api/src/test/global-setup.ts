// Vitest global setup for the node project: bring the test database's schema
// up to date and store the scenarios, as the API does at boot, so `pnpm test`
// works right after `docker compose up -d`.
import pg from 'pg';
import { createDb } from '../db/client.ts';
import { migrate } from '../db/migrate.ts';
import { migrationsDir, scenariosDir } from '../paths.ts';
import { readScenarioCatalog, syncScenarios } from '../scenarios.ts';
import { databaseAvailable, testDatabaseUrl } from './db.ts';

export default async function setup(): Promise<void> {
  if (!(await databaseAvailable())) return;
  const client = new pg.Client({ connectionString: testDatabaseUrl });
  await client.connect();
  try {
    await migrate(client, migrationsDir);
  } finally {
    await client.end();
  }

  const { pool, db } = createDb(testDatabaseUrl);
  try {
    await syncScenarios(db, (await readScenarioCatalog(scenariosDir)).scenarios);
  } finally {
    await pool.end();
  }
}
