import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAvailable, testDatabaseUrl } from '../test/db.ts';
import { migrate } from './migrate.ts';

const hasDb = await databaseAvailable();

// Runs in a throwaway schema so it never touches the real one.
describe.skipIf(!hasDb)('migration runner (real Postgres)', () => {
  const schema = `test_migrate_${randomUUID().replaceAll('-', '')}`;
  const client = new pg.Client({ connectionString: testDatabaseUrl });
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ccc-migrations-'));
    await client.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
  });

  afterAll(async () => {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
    await rm(dir, { recursive: true, force: true });
  });

  it('applies pending files in order, then is a no-op', async () => {
    await writeFile(join(dir, '0002_b.sql'), 'ALTER TABLE widgets ADD COLUMN name text;');
    await writeFile(join(dir, '0001_a.sql'), 'CREATE TABLE widgets (id int PRIMARY KEY);');
    await writeFile(join(dir, 'README.md'), 'not a migration');

    expect(await migrate(client, dir)).toEqual(['0001_a.sql', '0002_b.sql']);
    expect(await migrate(client, dir)).toEqual([]);

    const { rows } = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'widgets' ORDER BY ordinal_position`,
      [schema],
    );
    expect(rows.map((r) => r.column_name)).toEqual(['id', 'name']);
  });

  it('refuses to run when an applied migration was edited', async () => {
    await writeFile(join(dir, '0001_a.sql'), 'CREATE TABLE widgets (id bigint PRIMARY KEY);');
    await expect(migrate(client, dir)).rejects.toThrow(/0001_a\.sql was edited/);
  });

  it('rolls back a failing migration and names it', async () => {
    await writeFile(join(dir, '0001_a.sql'), 'CREATE TABLE widgets (id int PRIMARY KEY);');
    await writeFile(join(dir, '0003_bad.sql'), 'CREATE TABLE gadgets (id int); SELECT nope;');
    await expect(migrate(client, dir)).rejects.toThrow(/0003_bad\.sql failed/);
    const { rows } = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'gadgets'`,
      [schema],
    );
    expect(rows).toHaveLength(0);
  });
});
