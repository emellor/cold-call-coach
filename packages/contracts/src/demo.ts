// Demo calls: an expert rep, played by Claude, calls one of the prospects,
// the real prospect engine answers, Claude notes the technique behind every
// rep line, and Cartesia voices both sides. The agent writes them (it holds
// the Claude and Cartesia keys and the prospect engine); the API queues and
// stores them, and the web plays them.
import { z } from 'zod';
import { ScenarioId } from './call.ts';
import { Speaker } from './callLog.ts';
import { Difficulty } from './scenario.ts';

export const DemoStatus = z.enum(['queued', 'generating', 'ready', 'failed']);
export type DemoStatus = z.infer<typeof DemoStatus>;

/** How a demo call ended. `no_decision`: it ran out of turns without either. */
export const DemoOutcome = z.enum(['meeting_booked', 'hung_up_by_prospect', 'no_decision']);
export type DemoOutcome = z.infer<typeof DemoOutcome>;

/** The most demo calls one press of "Generate" queues. */
export const MAX_DEMO_BATCH = 20;

/** The pause between lines when a demo plays. */
export const DEMO_GAP_MS = 450;

/** One line of a demo call, as the player shows it. */
export const DemoTurn = z.object({
  idx: z.int().nonnegative(),
  speaker: Speaker,
  text: z.string(),
  /** Rep lines: the technique in a few words, and why the line works. */
  technique: z.string().nullable(),
  note: z.string().nullable(),
  /** Rep lines: her interest and patience after the line, 0–100. */
  interest: z.number().nullable(),
  patience: z.number().nullable(),
  /** How long the line's audio runs; null when it has none. */
  audioMs: z.int().nonnegative().nullable(),
});
export type DemoTurn = z.infer<typeof DemoTurn>;

export const DemoSummary = z.object({
  id: z.uuid(),
  /** Its place in the batch it was generated in, from 1. */
  position: z.int().positive(),
  status: DemoStatus,
  /** The approach the rep was given. */
  angle: z.string(),
  title: z.string().nullable(),
  /** Who the rep called; null if that prospect is no longer stored. */
  prospect: z
    .object({
      name: z.string(),
      role: z.string(),
      company: z.string(),
      difficulty: Difficulty,
    })
    .nullable(),
  outcome: DemoOutcome.nullable(),
  /** The call's length as it plays: every line's audio plus the gaps between them. */
  durationMs: z.int().nonnegative().nullable(),
  /** Why it failed, when it did. */
  error: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type DemoSummary = z.infer<typeof DemoSummary>;

/** `GET /api/demos`: newest batch first, each batch in order. */
export const DemoListResponse = z.object({ demos: z.array(DemoSummary) });
export type DemoListResponse = z.infer<typeof DemoListResponse>;

/** `GET /api/demos/:id` */
export const DemoDetail = DemoSummary.extend({
  summary: z.string().nullable(),
  /** The patterns to take away from it. */
  lessons: z.array(z.string()),
  /** The agreed slot, or why she hung up. */
  outcomeDetail: z.string().nullable(),
  turns: z.array(DemoTurn),
  costUsd: z.number().nullable(),
});
export type DemoDetail = z.infer<typeof DemoDetail>;

/** `POST /api/demos/generate` */
export const GenerateDemosRequest = z.object({
  count: z.int().min(1).max(MAX_DEMO_BATCH).default(MAX_DEMO_BATCH),
});
export type GenerateDemosRequest = z.infer<typeof GenerateDemosRequest>;

export const GenerateDemosResponse = z.object({ queued: z.int().nonnegative() });
export type GenerateDemosResponse = z.infer<typeof GenerateDemosResponse>;

// ---- The agent's side (/internal) ----

/** A demo for the agent to write. */
export const DemoJob = z.object({ id: z.uuid(), scenarioId: ScenarioId, angle: z.string() });
export type DemoJob = z.infer<typeof DemoJob>;

/** `POST /internal/demos/claim`: the next demo to write, or null when none is waiting. */
export const DemoClaimResponse = z.object({ job: DemoJob.nullable() });
export type DemoClaimResponse = z.infer<typeof DemoClaimResponse>;

/** `POST /internal/demos/:id/result`: the finished demo, audio as base64 MP3 per line. */
export const DemoResultRequest = z.object({
  scenarioVersion: z.int().positive(),
  title: z.string().min(1),
  summary: z.string(),
  lessons: z.array(z.string()),
  outcome: DemoOutcome,
  outcomeDetail: z.string().nullable(),
  costUsd: z.number().nonnegative().nullable(),
  turns: z
    .array(
      DemoTurn.extend({
        /** The line's MP3, base64; null if it couldn't be voiced. */
        audio: z.base64().nullable(),
      }),
    )
    .min(2),
});
export type DemoResultRequest = z.infer<typeof DemoResultRequest>;

/** `POST /internal/demos/:id/failed` */
export const DemoFailureRequest = z.object({ error: z.string().min(1).max(2000) });
export type DemoFailureRequest = z.infer<typeof DemoFailureRequest>;

/**
 * What Claude writes about a finished demo (structured output): a title, what
 * it shows, the lessons, and for each rep line the technique and why it works.
 * Counts and lengths are stated in words; code enforces them.
 */
export const DemoNotesDraft = z.object({
  title: z
    .string()
    .describe('A short title naming what the call shows, like "Turning a broker objection"'),
  summary: z
    .string()
    .describe('Two or three sentences on how the call went and what makes it worth studying'),
  lessons: z
    .array(z.string())
    .describe('Three to five patterns a trainee should copy, each one sentence'),
  lines: z
    .array(
      z.object({
        line: z.number().describe('The rep line number, as numbered in the transcript'),
        technique: z
          .string()
          .describe('The technique the line uses, in two to five words, like "Permission opener"'),
        note: z
          .string()
          .describe('One sentence to a trainee: why this line works at this point of the call'),
      }),
    )
    .describe('One entry for every rep line, in order'),
});
export type DemoNotesDraft = z.infer<typeof DemoNotesDraft>;
