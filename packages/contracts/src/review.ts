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

export const ReviewDraft = z.object({
  outcome: z.string().describe('One sentence: how the call ended, and why'),
  overallScore: z.number().describe('0 to 100'),
  summary: z.string().describe('Two or three sentences to the rep, in the second person'),
  stages: z
    .array(
      z.object({
        key: RubricCriterionKey,
        score: z.number().describe('1 to 5, using the rubric anchors'),
        evidence: z
          .array(z.object({ turn: turnRef, quote: exactWords('The speaker') }))
          .describe('One to three quotes that justify the score'),
        feedback: z.string().describe('One or two sentences to the rep'),
      }),
    )
    .describe('Exactly one entry per rubric criterion'),
  topMoments: z
    .array(
      z.object({
        turn: turnRef,
        youSaid: exactWords('The rep'),
        tryInstead: z.string().describe('What they could have said instead, as a line to say'),
        why: z.string().describe('One sentence'),
      }),
    )
    .describe('The three moments that most changed the call, most important first'),
  objections: z
    .array(
      z.object({
        turn: turnRef,
        objection: z.string().describe('Her objection, as she put it'),
        yourResponse: exactWords('The rep'),
        score: z.number().describe('1 to 5'),
        better: z.string().describe('A better response, as a line to say'),
      }),
    )
    .describe('Every objection she raised, in order, with the rep response that followed'),
  strengths: z.array(z.string()).describe('Up to three things the rep did well'),
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

export const EvidenceQuote = z.object({ turn, quote: z.string().min(1) });
export type EvidenceQuote = z.infer<typeof EvidenceQuote>;

export const StageReview = z.object({
  key: RubricCriterionKey,
  score: score5,
  evidence: z.array(EvidenceQuote),
  feedback: z.string(),
});
export type StageReview = z.infer<typeof StageReview>;

export const ReviewMoment = z.object({
  turn,
  youSaid: z.string().min(1),
  tryInstead: z.string(),
  why: z.string(),
});
export type ReviewMoment = z.infer<typeof ReviewMoment>;

export const ObjectionReview = z.object({
  turn,
  objection: z.string(),
  yourResponse: z.string().min(1),
  score: score5,
  better: z.string(),
});
export type ObjectionReview = z.infer<typeof ObjectionReview>;

export const ReviewResult = z.object({
  outcome: z.string(),
  overallScore: z.int().min(0).max(100),
  summary: z.string(),
  stages: z.array(StageReview),
  topMoments: z.array(ReviewMoment).max(3),
  objections: z.array(ObjectionReview),
  strengths: z.array(z.string()).max(3),
  drill: z.object({ title: z.string(), instructions: z.string() }),
  /** Quotes the model gave that aren't in the transcript; their items were dropped. */
  quotesDropped: z.int().nonnegative(),
});
export type ReviewResult = z.infer<typeof ReviewResult>;

export const ReviewStatus = z.enum(['pending', 'running', 'ready', 'failed', 'skipped']);
export type ReviewStatus = z.infer<typeof ReviewStatus>;
