// Hand-written to match apps/api/migrations/*.sql; it is not generated.
import type {
  CallLog,
  CallMode,
  CallOutcome,
  CallPhase,
  DebugLatencyPayload,
  Difficulty,
  EventKind,
  ReviewStatus,
  Speaker,
} from '@ccc/contracts';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/** The single local user (see migration 0001). */
export const LOCAL_USER_ID = '00000000-0000-0000-0000-000000000001';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
const usd = (name: string) => numeric(name, { precision: 12, scale: 6, mode: 'number' });

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
    durationMs: integer('duration_ms'),
    /** The live lanes (prospect and judge); the review's cost is on its own row. */
    costUsd: usd('cost_usd'),
    latency: jsonb('latency').$type<DebugLatencyPayload[]>(),
    usage: jsonb('usage').$type<CallLog['usage']>(),
    outcomeReason: text('outcome_reason'),
    recordingPath: text('recording_path'),
  },
  (t) => [index('calls_user_started_idx').on(t.userId, t.startedAt.desc())],
);

export const turns = pgTable(
  'turns',
  {
    callId: uuid('call_id')
      .notNull()
      .references(() => calls.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    speaker: text('speaker').$type<Speaker>().notNull(),
    text: text('text').notNull(),
    startMs: integer('start_ms').notNull(),
    endMs: integer('end_ms').notNull(),
    /** TimedWord[]; parse on the way out. */
    words: jsonb('words').$type<unknown>(),
    interrupted: boolean('interrupted').notNull().default(false),
    /** ProspectState; parse on the way out. */
    stateAfter: jsonb('state_after').$type<unknown>(),
  },
  (t) => [primaryKey({ columns: [t.callId, t.idx] })],
);

export const events = pgTable(
  'events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    callId: uuid('call_id')
      .notNull()
      .references(() => calls.id, { onDelete: 'cascade' }),
    tMs: integer('t_ms').notNull(),
    kind: text('kind').$type<EventKind>().notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  },
  (t) => [index('events_call_idx').on(t.callId, t.tMs)],
);

export const reviews = pgTable('reviews', {
  callId: uuid('call_id')
    .primaryKey()
    .references(() => calls.id, { onDelete: 'cascade' }),
  status: text('status').$type<ReviewStatus>().notNull(),
  rubricId: text('rubric_id'),
  rubricVersion: integer('rubric_version'),
  model: text('model'),
  /** ReviewResult; parse on the way out. */
  result: jsonb('result').$type<unknown>(),
  error: text('error'),
  costUsd: usd('cost_usd'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

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
    /** `file`: upserted from scenarios/. `custom`: written by "Add new". */
    source: text('source').$type<'file' | 'custom'>().notNull().default('file'),
    /** A custom prospect's description, in the rep's words. */
    description: text('description'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    /** Set when a custom prospect is removed: she leaves the picker, her calls stay. */
    archivedAt: timestamptz('archived_at'),
  },
  (t) => [primaryKey({ columns: [t.id, t.version] })],
);
