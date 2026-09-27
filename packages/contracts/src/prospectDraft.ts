// "Add new": a prospect written by Claude from the rep's own description of the
// person they want to practise on. Claude fills ProspectDraft through
// structured output; code adds the id, the difficulty's thresholds, the win
// condition, the rubric and the voice id, and validates the whole ScenarioSpec.
import { z } from 'zod';
import { Difficulty } from './scenario.ts';

/** The English locales the prompts can name, and Deepgram and Cartesia speak. */
export const ProspectLocale = z.enum(['en-GB', 'en-US', 'en-AU', 'en-IE', 'en-NZ', 'en-CA']);
export type ProspectLocale = z.infer<typeof ProspectLocale>;

// Structured outputs can't bound lengths, so the counts are stated in words and
// enforced when the draft becomes a ScenarioSpec.
export const ProspectDraft = z.object({
  title: z
    .string()
    .describe(
      'A short label for the picker, like "Busy finance director" or "Facilities manager who hates cold calls"',
    ),
  difficulty: Difficulty.describe(
    'easy: open and has time; medium: busy and sceptical; hard: hostile to cold calls, short with the rep',
  ),
  locale: ProspectLocale.describe('Where she is from: en-GB unless the description says otherwise'),
  prospect: z.object({
    name: z.string().describe('Her first and last name'),
    role: z.string().describe('Her job title'),
    company: z.string().describe("Her company's name"),
    companyFacts: z.string().describe('One line: what the company does, its size and its sites'),
    personality: z.string().describe('Her attitude and temperament, in one line'),
    speakingStyle: z
      .string()
      .describe('How she talks, with two or three phrases she uses, in one line'),
    openingLine: z.string().describe('How she answers the phone: a few words'),
    hidden: z.object({
      pains: z
        .array(z.string())
        .describe(
          'One to three problems a rep earns with good questions; at least one that the product genuinely helps with',
        ),
      currentSolution: z.string().describe('What she does about energy today'),
      decisionProcess: z.string().describe('Who decides on a purchase like this, and how'),
      timing: z.string().describe('Deadlines or budget timing that matter to her'),
    }),
    objections: z
      .array(z.string())
      .describe('Three to five objections she would really use, in her own words'),
  }),
  voice: z.object({
    hint: z
      .string()
      .describe('What her voice sounds like: age, accent and manner, for choosing a voice'),
    speed: z.enum(['slow', 'normal', 'fast']).describe('How fast she talks'),
  }),
});
export type ProspectDraft = z.infer<typeof ProspectDraft>;

/** A voice Claude may choose for her (from Cartesia's library). */
export interface VoiceChoice {
  id: string;
  name: string;
  description: string;
}
