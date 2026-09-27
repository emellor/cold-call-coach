// Demo calls: model cold calls to read. Claude writes each one in a single
// structured-output request: an expert rep calling one of the prospects with a
// given approach, the whole conversation, and the technique behind every line
// the rep says. The API writes and stores them; the web shows the transcript.
import { z } from 'zod';
import { Speaker } from './callLog.ts';
import { Difficulty } from './scenario.ts';

export const DemoStatus = z.enum(['queued', 'generating', 'ready', 'failed']);
export type DemoStatus = z.infer<typeof DemoStatus>;

/**
 * How a demo call ended. A written demo always books the meeting; the other two
 * are kept for rows written by the old voiced simulator.
 */
export const DemoOutcome = z.enum(['meeting_booked', 'hung_up_by_prospect', 'no_decision']);
export type DemoOutcome = z.infer<typeof DemoOutcome>;

/** The most demo calls one press of "Generate" queues. */
export const MAX_DEMO_BATCH = 20;

/** One line of a demo call. */
export const DemoTurn = z.object({
  idx: z.int().nonnegative(),
  speaker: Speaker,
  text: z.string(),
  /** Rep lines: the technique in a few words, and why the line works; null on hers. */
  technique: z.string().nullable(),
  note: z.string().nullable(),
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
  /** The meeting she agreed to. */
  outcomeDetail: z.string().nullable(),
  turns: z.array(DemoTurn),
  /** What writing it cost; null if the model wasn't priced. */
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

/**
 * What Claude writes for a demo call (structured output): the whole call, line
 * by line, with the technique behind each of the rep's lines, then a title,
 * the meeting agreed, a summary and the lessons. Counts and lengths are stated
 * in words; code enforces them (`scriptFrom` in core).
 */
export const DemoScriptDraft = z.object({
  lines: z
    .array(
      z.object({
        speaker: Speaker.describe('"prospect" for her, "rep" for the caller'),
        text: z.string().describe('Exactly what is said, as it would be spoken on the phone'),
        technique: z
          .string()
          .nullable()
          .describe(
            'Rep lines: the technique in two to five words, like "Permission opener". Null on her lines',
          ),
        note: z
          .string()
          .nullable()
          .describe(
            'Rep lines: one sentence to a trainee on why this line works at this point. Null on her lines',
          ),
      }),
    )
    .describe('The whole call in order, starting with her answering the phone'),
  meeting: z
    .string()
    .describe('The meeting she agrees to, as confirmed on the call: day, time and format'),
  title: z
    .string()
    .describe('A short title naming what the call shows, like "Turning a broker objection"'),
  summary: z
    .string()
    .describe('Two or three sentences on how the call goes and what makes it a model call'),
  lessons: z
    .array(z.string())
    .describe('Three to five patterns a trainee should copy, each one sentence'),
});
export type DemoScriptDraft = z.infer<typeof DemoScriptDraft>;
