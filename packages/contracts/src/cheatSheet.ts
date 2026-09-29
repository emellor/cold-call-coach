// Cheat sheets: one page of notes to keep in front of you on a real call.
// Claude writes one from the rep's profile of the person they're about to call:
// the opener, why you're calling, questions to ask, answers to what they're
// likely to ask and object, lines tying WattGuard to a problem, the close and a
// voicemail. Short phrases, to read at a glance mid-call.
import { z } from 'zod';
import { MIN_BRIEF_LENGTH } from './demo.ts';

/** Something they say or ask, and what to say back. */
export const CheatSheetReply = z.object({
  they: z.string().describe('What they say or ask, in their words, in a few words'),
  you: z
    .string()
    .describe('What to say back: one or two short sentences the rep can say as they are'),
});
export type CheatSheetReply = z.infer<typeof CheatSheetReply>;

/**
 * What Claude writes (structured output). Counts and lengths are stated in
 * words; code enforces the counts (`cheatSheetFrom` in core).
 */
export const CheatSheetDraft = z.object({
  title: z.string().describe('Who the call is to and the business, like "Sarah Patel, Carewell"'),
  goal: z.string().describe('The one thing the rep wants from this call, in under ten words'),
  opener: z.array(z.string()).describe('One or two lines to open the call, word for word'),
  reason: z
    .string()
    .describe("Why you're calling, in their terms: one or two short sentences to say"),
  questions: z
    .array(z.string())
    .describe(
      'Four to six open questions, each under fifteen words, in the order a call reaches them',
    ),
  theirQuestions: z
    .array(CheatSheetReply)
    .describe('Three to five questions they are likely to ask, each with an honest answer'),
  objections: z
    .array(CheatSheetReply)
    .describe('Four to six objections they are likely to raise, each with a reply'),
  valueLines: z
    .array(CheatSheetReply)
    .describe('Two or three problems they may mention, each with one line tying the product to it'),
  close: z
    .array(z.string())
    .describe('One or two lines asking for the next step with a specific day and time'),
  voicemail: z.string().describe('A voicemail to leave if they do not answer, under forty words'),
});
export type CheatSheetDraft = z.infer<typeof CheatSheetDraft>;

export const CheatSheetSummary = z.object({
  id: z.uuid(),
  title: z.string(),
  goal: z.string(),
  createdAt: z.iso.datetime(),
});
export type CheatSheetSummary = z.infer<typeof CheatSheetSummary>;

/** `GET /api/cheat-sheets`: newest first. */
export const CheatSheetListResponse = z.object({ sheets: z.array(CheatSheetSummary) });
export type CheatSheetListResponse = z.infer<typeof CheatSheetListResponse>;

/** `GET /api/cheat-sheets/:id` */
export const CheatSheetDetail = CheatSheetSummary.extend({
  /** The rep's profile it was written from. */
  brief: z.string(),
  /** Claude's draft, cleaned: blank lines dropped and each list capped. */
  sheet: CheatSheetDraft,
  /** What writing it cost; null if the model wasn't priced. */
  costUsd: z.number().nullable(),
});
export type CheatSheetDetail = z.infer<typeof CheatSheetDetail>;

/** `POST /api/cheat-sheets`: written while the rep waits, about half a minute. */
export const CreateCheatSheetRequest = z.object({
  brief: z
    .string()
    .trim()
    .min(
      MIN_BRIEF_LENGTH,
      'Say a little more: who you are calling, their business and what you want.',
    )
    .max(2000, 'Keep the profile under 2,000 characters.'),
});
export type CreateCheatSheetRequest = z.infer<typeof CreateCheatSheetRequest>;

export const CreateCheatSheetResponse = z.object({ id: z.uuid() });
export type CreateCheatSheetResponse = z.infer<typeof CreateCheatSheetResponse>;
