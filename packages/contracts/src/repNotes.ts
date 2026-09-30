// A reverse call's notes: the rep played the prospect and Sam, Claude as an
// expert rep, made the call. Afterwards Claude, as a sales trainer, annotates
// Sam's side so the rep can study what he said and why. Stored where a review
// would be (reviews.notes), and shown on the call's page in its place.
//
// Turn numbers are the transcript's, counted from 1 (LoggedTurn.idx + 1).
import { z } from 'zod';

/** The technique behind one of Sam's lines, and why it works there. */
export const RepNote = z.object({
  turn: z.number().describe("The transcript turn number of Sam's line"),
  technique: z.string().describe('The technique, in two to five words'),
  note: z
    .string()
    .describe(
      'Why it works at that point of the call, in one sentence, referring to what she had just said; for a misstep, what would have worked better',
    ),
});
export type RepNote = z.infer<typeof RepNote>;

/**
 * What Claude writes (structured output). Counts and lengths are stated in
 * words; code keeps the notes that point at one of Sam's lines (`repNotesFrom`
 * in core).
 */
export const RepNotesDraft = z.object({
  notes: z.array(RepNote).describe("One for each of Sam's lines, in order"),
  summary: z
    .string()
    .describe('Two or three sentences: how the call went, and what Sam did that decided it'),
  lessons: z
    .array(z.string())
    .describe("Three to five patterns from Sam's side to copy on your own calls"),
});
export type RepNotesDraft = z.infer<typeof RepNotesDraft>;

/** The notes as stored: the draft cleaned, each note on one of Sam's lines, in turn order. */
export const RepNotes = z.object({
  notes: z.array(z.object({ turn: z.int().positive(), technique: z.string(), note: z.string() })),
  summary: z.string(),
  lessons: z.array(z.string()),
});
export type RepNotes = z.infer<typeof RepNotes>;
