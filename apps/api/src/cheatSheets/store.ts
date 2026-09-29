// Cheat sheets in Postgres: stored whole as Claude wrote them (cleaned), listed
// newest first, and deleted when the rep is done with one.
import type { CheatSheetDetail, CheatSheetSummary } from '@ccc/contracts';
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { cheatSheets } from '../db/schema.ts';
import type { WrittenCheatSheet } from './writer.ts';

type Row = typeof cheatSheets.$inferSelect;

const summaryOf = (row: Row): CheatSheetSummary => ({
  id: row.id,
  title: row.title,
  goal: row.sheet.goal,
  createdAt: row.createdAt.toISOString(),
});

/** Stores a written sheet. Returns its id. */
export async function insertCheatSheet(
  db: Db,
  input: WrittenCheatSheet & { brief: string },
): Promise<string> {
  const [row] = await db
    .insert(cheatSheets)
    .values({
      brief: input.brief,
      title: input.sheet.title,
      sheet: input.sheet,
      model: input.model,
      costUsd: input.costUsd,
    })
    .returning({ id: cheatSheets.id });
  if (!row) throw new Error('The cheat sheet was not stored.');
  return row.id;
}

/** Every sheet, newest first. */
export async function listCheatSheets(db: Db): Promise<CheatSheetSummary[]> {
  const rows = await db.select().from(cheatSheets).orderBy(desc(cheatSheets.createdAt));
  return rows.map(summaryOf);
}

export async function cheatSheetDetail(db: Db, id: string): Promise<CheatSheetDetail | null> {
  const [row] = await db.select().from(cheatSheets).where(eq(cheatSheets.id, id));
  if (!row) return null;
  return { ...summaryOf(row), brief: row.brief, sheet: row.sheet, costUsd: row.costUsd };
}

/** False if there is no such sheet. */
export async function deleteCheatSheet(db: Db, id: string): Promise<boolean> {
  const deleted = await db
    .delete(cheatSheets)
    .where(eq(cheatSheets.id, id))
    .returning({ id: cheatSheets.id });
  return deleted.length > 0;
}
