// Demo calls: model cold calls to read, or to listen to. Claude writes each one
// in a single structured-output request: an expert rep calling one of the
// prospects with a given approach, or whoever the rep describes in a brief, the
// whole conversation, and the technique behind every line the rep says. The API
// writes and stores them; the web shows the transcript and reads it aloud.
import { z } from 'zod';
import { Speaker } from './callLog.ts';
import { ScenarioSummary } from './http.ts';
import { ProspectLocale } from './prospectDraft.ts';
import { Difficulty } from './scenario.ts';

export const DemoStatus = z.enum(['queued', 'generating', 'ready', 'failed']);
export type DemoStatus = z.infer<typeof DemoStatus>;

/**
 * How a demo call ended. A demo written for one of the prospects books the
 * meeting; one written from the rep's brief ends with the brief's objective
 * agreed. The other two are kept for rows written by the old voiced simulator.
 */
export const DemoOutcome = z.enum([
  'meeting_booked',
  'objective_met',
  'hung_up_by_prospect',
  'no_decision',
]);
export type DemoOutcome = z.infer<typeof DemoOutcome>;

/** The most demo calls one press of "Generate" queues. */
export const MAX_DEMO_BATCH = 20;

/** Picks the prospect's voice when a demo is read aloud. The shipped prospects are all women. */
export const DemoGender = z.enum(['female', 'male']);
export type DemoGender = z.infer<typeof DemoGender>;

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
  /** The approach the rep was given; null for a demo written from the rep's brief. */
  angle: z.string().nullable(),
  /** The rep's own description of the call, for a demo written from one. */
  brief: z.string().nullable(),
  title: z.string().nullable(),
  /**
   * Who the rep called; null if that prospect is no longer stored, or while a
   * demo from a brief is still being written (Claude names the prospect).
   */
  prospect: z
    .object({
      name: z.string(),
      role: z.string(),
      company: z.string(),
      difficulty: Difficulty,
      gender: DemoGender,
      /** Picks the voices when the call is read aloud, e.g. en-GB. */
      locale: z.string(),
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
  /** The meeting she agreed to, or whatever else the brief set as the objective. */
  outcomeDetail: z.string().nullable(),
  turns: z.array(DemoTurn),
  /** What writing it cost; null if the model wasn't priced. */
  costUsd: z.number().nullable(),
  /** The prospect added to practise this call, while she is still in the picker. */
  practiceProspect: z.object({ id: z.string(), name: z.string() }).nullable(),
});
export type DemoDetail = z.infer<typeof DemoDetail>;

/** `POST /api/demos/generate` */
export const GenerateDemosRequest = z.object({
  count: z.int().min(1).max(MAX_DEMO_BATCH).default(MAX_DEMO_BATCH),
});
export type GenerateDemosRequest = z.infer<typeof GenerateDemosRequest>;

export const GenerateDemosResponse = z.object({ queued: z.int().nonnegative() });
export type GenerateDemosResponse = z.infer<typeof GenerateDemosResponse>;

/** The shortest brief a demo is written from: a name and a job is not enough. */
export const MIN_BRIEF_LENGTH = 20;

/** `POST /api/demos`: one demo call, written from the rep's description of it. */
export const CreateDemoRequest = z.object({
  brief: z
    .string()
    .trim()
    .min(
      MIN_BRIEF_LENGTH,
      'Say a little more: who you are calling, their business and what you want.',
    )
    .max(2000, 'Keep the brief under 2,000 characters.'),
});
export type CreateDemoRequest = z.infer<typeof CreateDemoRequest>;

export const CreateDemoResponse = z.object({ id: z.uuid() });
export type CreateDemoResponse = z.infer<typeof CreateDemoResponse>;

/**
 * `POST /api/demos/:id/practice`: the prospect from a demo's brief, added to
 * the picker so the rep can practise that call (201), or the one already added (200).
 */
export const PracticeProspectResponse = z.object({ scenario: ScenarioSummary });
export type PracticeProspectResponse = z.infer<typeof PracticeProspectResponse>;

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

/** Who a demo from the rep's brief calls, as Claude writes them. Stored with the demo. */
export const DemoProspect = z
  .object({
    name: z.string().describe("The prospect's full name: from the brief, or one that fits it"),
    role: z.string().describe('Their job title'),
    company: z.string().describe('Their company'),
    difficulty: Difficulty.describe('How hard they are to win: easy, medium or hard'),
    gender: DemoGender.describe('A woman or a man, as the brief says; a woman if it does not say'),
    locale: ProspectLocale.describe('Where they are from: en-GB unless the brief says otherwise'),
  })
  .describe('Who the rep calls');
export type DemoProspect = z.infer<typeof DemoProspect>;

/**
 * What Claude writes for a demo from the rep's brief: the same call, plus who
 * the prospect is, since the brief is the rep's own words rather than one of
 * the stored prospects, and what they agreed to, since a brief can set the call
 * an objective other than a meeting.
 */
export const DemoBriefDraft = DemoScriptDraft.extend({
  prospect: DemoProspect,
  meeting: z
    .string()
    .describe(
      'What the prospect agrees to by the end, as confirmed on the call: for a meeting, its day, time and format',
    ),
});
export type DemoBriefDraft = z.infer<typeof DemoBriefDraft>;
