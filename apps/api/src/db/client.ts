import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.ts';

export type Db = NodePgDatabase<typeof schema>;

export function createDb(connectionString: string): { pool: pg.Pool; db: Db } {
  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 5_000 });
  const db = drizzle(pool, { schema });
  return { pool, db };
}
