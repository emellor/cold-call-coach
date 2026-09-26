// The data files in scenarios/ (PLAN.md §6.1, §8.5). Every file validates
// against these, in a test and again when the API loads it.
import { z } from 'zod';
import { ScenarioId } from './call.ts';

export const Difficulty = z.enum(['easy', 'medium', 'hard']);
export type Difficulty = z.infer<typeof Difficulty>;

const text = z.string().trim().min(1);
const percent = z.int().min(0).max(100);

/** Marks a voice id that still needs filling in; the agent then falls back to CARTESIA_VOICE_ID. */
export const VOICE_ID_PLACEHOLDER = 'REPLACE_WITH_CARTESIA_VOICE_ID';

export const VoiceSpec = z.object({
  provider: z.literal('cartesia'),
  voiceId: text,
  /** Cartesia sonic-3 speed: a preset or a multiplier (0.6–2.0). */
  speed: z
    .union([z.enum(['slow', 'normal', 'fast']), z.number().min(0.6).max(2)])
    .default('normal'),
  /** What to look for in Cartesia's voice library when filling in `voiceId`. */
  hint: text.optional(),
});
export type VoiceSpec = z.infer<typeof VoiceSpec>;

/**
 * The private facts' keys, the judge's `revealEarned` vocabulary. Fixed rather
 * than per scenario so the judge's structured-output schema never changes
 * (a new schema costs a one-off compilation delay on its first request).
 */
export const FactKey = z.enum([
  'pain_1',
  'pain_2',
  'pain_3',
  'current_solution',
  'decision_process',
  'timing',
]);
export type FactKey = z.infer<typeof FactKey>;

export const HiddenFacts = z.object({
  /** One to three, keyed pain_1… in order. */
  pains: z.array(text).min(1).max(3),
  currentSolution: text,
  decisionProcess: text,
  timing: text,
});
export type HiddenFacts = z.infer<typeof HiddenFacts>;

export const ProspectSpec = z.object({
  name: text,
  role: text,
  company: text,
  companyFacts: text,
  personality: text,
  speakingStyle: text,
  openingLine: text,
  hidden: HiddenFacts,
  objections: z.array(text).min(1),
});
export type ProspectSpec = z.infer<typeof ProspectSpec>;

/** Hidden-state starting values and thresholds (PLAN.md §6.3). */
export const StateSpec = z
  .object({
    interest: percent,
    patience: percent,
    patienceDecayPerTurn: z.number().min(0).max(50),
    hangUpAt: percent,
    meetingAt: percent,
  })
  .refine((s) => s.patience > s.hangUpAt, 'patience must start above hangUpAt')
  .refine((s) => s.meetingAt > s.interest, 'meetingAt must be above the starting interest');
export type StateSpec = z.infer<typeof StateSpec>;

export const ScenarioSpec = z.object({
  id: ScenarioId,
  version: z.int().positive(),
  title: text,
  difficulty: Difficulty,
  /** BCP 47, e.g. en-GB: drives the prompt's spelling and idiom and the STT language. */
  locale: z.string().regex(/^[a-z]{2}-[A-Z]{2}$/),
  prospect: ProspectSpec,
  voice: VoiceSpec,
  avatar: z.object({ url: text, body: z.enum(['F', 'M']) }),
  state: StateSpec,
  winCondition: text,
  rubricId: text,
});
export type ScenarioSpec = z.infer<typeof ScenarioSpec>;

/** What you sell. The judge and the review see it; the prospect never does. */
export const ProductSpec = z.object({
  name: text,
  oneLiner: text,
  valuePoints: z.array(text).min(1),
  idealCustomer: text,
  callGoal: text,
  /** Biases Deepgram towards the product's vocabulary. */
  keyterms: z.array(text),
});
export type ProductSpec = z.infer<typeof ProductSpec>;

export const RubricCriterionKey = z.enum([
  'opener',
  'reason',
  'discovery',
  'objections',
  'next_step',
  'delivery',
]);
export type RubricCriterionKey = z.infer<typeof RubricCriterionKey>;

export const RubricSpec = z.object({
  id: text,
  version: z.int().positive(),
  title: text,
  criteria: z
    .array(
      z.object({
        key: RubricCriterionKey,
        name: text,
        goodLooksLike: text,
        anchors: z.object({ '1': text, '3': text, '5': text }),
      }),
    )
    .length(6)
    .refine((c) => new Set(c.map((x) => x.key)).size === 6, 'each criterion appears once'),
});
export type RubricSpec = z.infer<typeof RubricSpec>;

/** Everything in scenarios/, checked as a whole: the cross-file references must resolve. */
export const ScenarioCatalog = z
  .object({
    product: ProductSpec,
    rubrics: z.array(RubricSpec).min(1),
    scenarios: z.array(ScenarioSpec).min(1),
  })
  .superRefine((catalog, ctx) => {
    const rubricIds = new Set(catalog.rubrics.map((r) => r.id));
    const seen = new Set<string>();
    catalog.scenarios.forEach((scenario, i) => {
      const key = `${scenario.id}@${scenario.version}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['scenarios', i, 'id'],
          message: `duplicate scenario ${key}`,
        });
      }
      seen.add(key);
      if (!rubricIds.has(scenario.rubricId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['scenarios', i, 'rubricId'],
          message: `no rubric with id "${scenario.rubricId}"`,
        });
      }
    });
  });
export type ScenarioCatalog = z.infer<typeof ScenarioCatalog>;
