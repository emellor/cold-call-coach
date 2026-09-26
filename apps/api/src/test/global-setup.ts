// Vitest global setup for the node project: bring the test database's schema
// up to date so `pnpm test` works right after `docker compose up -d`.
import pg from 'pg';
import { migrate } from '../db/migrate.ts';
import { migrationsDir } from '../paths.ts';
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
}
