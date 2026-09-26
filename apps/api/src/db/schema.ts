// Hand-written to match apps/api/migrations/*.sql; it is not generated.
import type { CallMode, CallOutcome, CallPhase, Difficulty } from '@ccc/contracts';
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/** The single local user (see migration 0001). */
export const LOCAL_USER_ID = '00000000-0000-0000-0000-000000000001';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const calls = pgTable(
  'calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    scenarioId: text('scenario_id').notNull(),
    scenarioVersion: integer('scenario_version').notNull(),
    mode: text('mode').$type<CallMode>().notNull(),
    status: text('status').$type<CallPhase>().notNull().default('ringing'),
    outcome: text('outcome').$type<CallOutcome>(),
    startedAt: timestamptz('started_at').notNull().defaultNow(),
    connectedAt: timestamptz('connected_at'),
    endedAt: timestamptz('ended_at'),
  },
  (t) => [index('calls_user_started_idx').on(t.userId, t.startedAt.desc())],
);

export const scenarios = pgTable(
  'scenarios',
  {
    id: text('id').notNull(),
    version: integer('version').notNull(),
    title: text('title').notNull(),
    difficulty: text('difficulty').$type<Difficulty>().notNull(),
    /** A ScenarioSpec as it was when stored; parse it on the way out, the schema may have moved on. */
    spec: jsonb('spec').$type<unknown>().notNull(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.id, t.version] })],
);
