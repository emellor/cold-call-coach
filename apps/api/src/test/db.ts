// Shared by the API's database-backed tests. They run against a real Postgres,
// never a mocked Drizzle: the defects worth catching live in what Postgres
// actually returns for a given query.
import pg from 'pg';
import { DEV_DATABASE_URL } from '../config.ts';

export const testDatabaseUrl = process.env.DATABASE_URL ?? DEV_DATABASE_URL;

const redacted = testDatabaseUrl.replace(/\/\/[^@/]*@/, '//***@');

/**
 * True when the test database answers. When it does not, database tests skip
 * with a loud warning, unless REQUIRE_DB=1 (CI), where a missing database is a
 * failure rather than a quietly green run.
 */
export async function databaseAvailable(): Promise<boolean> {
  const client = new pg.Client({
    connectionString: testDatabaseUrl,
    connectionTimeoutMillis: 2_000,
  });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (process.env.REQUIRE_DB === '1') {
      throw new Error(
        `REQUIRE_DB=1 but the test database (${redacted}) is unreachable: ${reason}`,
        {
          cause: error,
        },
      );
    }
    console.warn(
      `\n⚠️  SKIPPING DATABASE TESTS: no Postgres at ${redacted} (${reason}).\n` +
        '   Start it with `docker compose up -d`; set REQUIRE_DB=1 to make this a failure.\n',
    );
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}
