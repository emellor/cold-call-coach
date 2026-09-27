// The post-call review (PLAN.md §8.4). Claude fills ReviewDraft through
// structured output; code then validates every quote against the transcript,
// clamps the scores and stores a ReviewResult.
//
// Turn numbers are the transcript's, counted from 1 (LoggedTurn.idx + 1).
import { z } from 'zod';
import { RubricCriterionKey } from './scenario.ts';

// Structured outputs can't constrain numbers or lengths, so the draft states
// the ranges in words and code enforces them when finalising.
const turnRef = z.number().describe('The transcript turn number it comes from');
const exactWords = (who: string) =>
  z.string().describe(`${who}'s exact words, copied character for character from that turn`);

/**
 * The kinds of moment in the walkthrough: a rep turn that worked, a rep turn
 * that hurt the call, and something she said that the rep should have picked
 * up on and didn't.
 */
export const MomentKind = z.enum(['strong', 'mistake', 'missed']);
export type MomentKind = z.infer<typeof MomentKind>;

export const ReviewDraft = z.object({
  outcome: z.string().describe('One sentence: how the call ended, and why'),
  overallScore: z.number().describe('0 to 100'),
  summary: z
    .string()
    .describe(
      'Three or four sentences to the rep, in the second person: how the call went, the change that would have made the biggest difference, and one thing to keep doing',
    ),
  stages: z
    .array(
      z.object({
        key: RubricCriterionKey,
        score: z.number().describe('1 to 5, using the rubric anchors'),
        evidence: z
          .array(z.object({ turn: turnRef, quote: exactWords('The speaker') }))
          .describe('One to three quotes that justify the score'),
        feedback: z
          .string()
          .describe(
            'What the rep did in this part of the call and how it landed with her, in two to four sentences to the rep',
          ),
        nextTime: z
          .string()
          .describe(
            'The one thing to do differently in this part of the call next time, with the words to say',
          ),
      }),
    )
    .describe('Exactly one entry per rubric criterion'),
  moments: z
    .array(
      z.object({
        turn: turnRef,
        kind: MomentKind.describe(
          "strong: a rep turn that worked; mistake: a rep turn that hurt the call; missed: something she said that the rep should have picked up on and didn't",
        ),
        stage: RubricCriterionKey.describe('The part of the call the moment belongs to'),
        quote: z
          .string()
          .describe(
            "Exact words from that turn, copied character for character: the rep's for strong and mistake, hers for missed",
          ),
        whatHappened: z
          .string()
          .describe(
            'To the rep, in one or two sentences: what happened and how it landed with her. For a mistake, say plainly what went wrong; for missed, what she was offering',
          ),
        sayInstead: z
          .string()
          .describe(
            'For mistake and missed: the exact words the rep should have said at that point, as a line to say out loud. Empty for strong',
          ),
        why: z
          .string()
          .describe('One sentence: the technique, and why it works at that point of the call'),
      }),
    )
    .describe(
      'The call walked through in turn order: every moment that changed how it went, four to ten of them. Include every mistake and missed opportunity that mattered, and the strong moments worth repeating',
    ),
  objections: z
    .array(
      z.object({
        turn: turnRef,
        objection: z.string().describe('Her objection, as she put it'),
        yourResponse: exactWords('The rep'),
        score: z.number().describe('1 to 5'),
        better: z
          .string()
          .describe(
            'A better response, as a line to say: acknowledge it, ask about it, answer briefly, check it landed',
          ),
      }),
    )
    .describe('Every objection she raised, in order, with the rep response that followed'),
  strengths: z
    .array(z.string())
    .describe('Up to three things the rep did well, each specific to this call'),
  priorities: z
    .array(z.string())
    .describe(
      "The three changes that would most improve the rep's next call, most important first: one sentence each, specific enough to act on",
    ),
  drill: z.object({
    title: z.string(),
    instructions: z
      .string()
      .describe('One practice exercise for the weakest area, in 2-4 sentences'),
  }),
});
export type ReviewDraft = z.infer<typeof ReviewDraft>;

const turn = z.int().positive();
const score5 = z.int().min(1).max(5);
/** The walkthrough asks for four to ten; anything past this is cut. */
export const MAX_MOMENTS = 12;

export const EvidenceQuote = z.object({ turn, quote: z.string().min(1) });
export type EvidenceQuote = z.infer<typeof EvidenceQuote>;

export const StageReview = z.object({
  key: RubricCriterionKey,
  score: score5,
  evidence: z.array(EvidenceQuote),
  feedback: z.string(),
  /** Absent from reviews stored before the walkthrough. */
  nextTime: z.string().optional(),
});
export type StageReview = z.infer<typeof StageReview>;

/** One moment of the walkthrough, pinned to the transcript turn its quote is from. */
export const ReviewMoment = z.object({
  turn,
  kind: MomentKind,
  stage: RubricCriterionKey,
  /** The rep's words, or hers for a missed opportunity. */
  quote: z.string().min(1),
  whatHappened: z.string(),
  /** Empty for a strong moment. */
  sayInstead: z.string(),
  why: z.string(),
});
export type ReviewMoment = z.infer<typeof ReviewMoment>;

/** Before the walkthrough, a review picked three moments instead. Older rows still carry them. */
export const TopMoment = z.object({
  turn,
  youSaid: z.string().min(1),
  tryInstead: z.string(),
  why: z.string(),
});
export type TopMoment = z.infer<typeof TopMoment>;

export const ObjectionReview = z.object({
  turn,
  objection: z.string(),
  yourResponse: z.string().min(1),
  score: score5,
  better: z.string(),
});
export type ObjectionReview = z.infer<typeof ObjectionReview>;

// Reviews are stored as they were written, so a field added later is optional:
// an older row still parses, and the page shows what it has.
export const ReviewResult = z.object({
  outcome: z.string(),
  overallScore: z.int().min(0).max(100),
  summary: z.string(),
  stages: z.array(StageReview),
  /** The walkthrough, in turn order. Absent from reviews stored before it. */
  moments: z.array(ReviewMoment).max(MAX_MOMENTS).optional(),
  /** Only in reviews stored before the walkthrough. */
  topMoments: z.array(TopMoment).max(3).optional(),
  objections: z.array(ObjectionReview),
  strengths: z.array(z.string()).max(3),
  /** The three changes that would most improve the next call. Absent from older reviews. */
  priorities: z.array(z.string()).max(3).optional(),
  drill: z.object({ title: z.string(), instructions: z.string() }),
  /** Quotes the model gave that aren't in the transcript; their items were dropped. */
  quotesDropped: z.int().nonnegative(),
});
export type ReviewResult = z.infer<typeof ReviewResult>;

export const ReviewStatus = z.enum(['pending', 'running', 'ready', 'failed', 'skipped']);
export type ReviewStatus = z.infer<typeof ReviewStatus>;
