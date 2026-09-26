// Hand-written to match apps/api/migrations/*.sql; it is not generated.
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** The single local user (see migration 0001). */
export const LOCAL_USER_ID = '00000000-0000-0000-0000-000000000001';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
