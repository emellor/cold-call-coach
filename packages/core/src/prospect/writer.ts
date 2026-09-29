// "Add new": the prompt that turns the rep's description of a person into a
// prospect, and the code that turns Claude's draft into a ScenarioSpec. Claude
// writes the person. The numbers that make a call winnable (her thresholds),
// the win condition and the rubric come from the shipped scenario of the same
// difficulty, which scenarios.test.ts proves a good rep can win and a pushy
// one loses.
import {
  type DemoGender,
  type Difficulty,
  type ProductSpec,
  type ProspectDraft,
  ScenarioSpec,
  VOICE_ID_PLACEHOLDER,
  type VoiceChoice,
} from '@ccc/contracts';

/**
 * A draft is ~1k tokens of JSON; the rest is room for the thinking before it at
 * medium effort, which Opus 5.5 does more of than Opus 5 did.
 */
export const PROSPECT_WRITER_MAX_TOKENS = 8_192;

export class ProspectDraftError extends Error {
  override name = 'ProspectDraftError';
}

const example = (scenario: ScenarioSpec): string =>
  `- "${scenario.title}" (${scenario.difficulty}, ${scenario.locale}): ${JSON.stringify(scenario.prospect)}`;

export function buildProspectWriterSystemPrompt(input: {
  product: ProductSpec;
  /** The shipped scenarios, as examples of the level of detail. */
  examples: readonly ScenarioSpec[];
  /** Voices to choose from; none when the voice library can't be read. */
  voices: readonly VoiceChoice[];
}): string {
  const { product, examples, voices } = input;
  const voiceList = voices.length
    ? `

Choose her voice (voiceId) from this list, to fit her age, accent and manner. Pick one whose accent matches her locale:
${voices.map((v) => `- ${v.id}: ${v.name}. ${v.description}`).join('\n')}`
    : '';
  return `You write prospects for a cold-call practice app. A sales rep phones the prospect in a live voice call, and an AI plays her from what you write, so make her specific, realistic and consistent.

What the rep sells:
- ${product.name}: ${product.oneLiner}
- Value: ${product.valuePoints.join('; ')}
- Ideal customer: ${product.idealCustomer}
- The call's goal: ${product.callGoal}

The rep describes the person they want to practise on. Write her:
- Keep every detail the description gives: her job, her company, her attitude, her situation. Invent the rest, realistically for her country and her kind of business.
- She is a woman: the app refers to every prospect as "she". If the description says otherwise, keep everything else about the person.
- Difficulty: easy is open and has time; medium is busy and sceptical, and needs a good reason to keep talking; hard is hostile to cold calls and short with the rep, and gives nothing until the rep is relevant to her. Take it from the description: "very tough to sell to" is hard.
- Her hidden facts are what a good rep earns with the right questions: one to three pains, what she uses today, who decides and how, and her timing. At least one pain must be something ${product.name} genuinely helps with, so a skilled rep can win even a hard call.
- Her objections come from who she is: someone with an in-house software team says they could build it themselves; someone with a broker says the broker handles energy. Write three to five, in her own words.
- She doesn't know what the rep sells until she's told, so her opening line and style never mention ${product.name}.
- Use the spelling of her locale.

The app's existing prospects, for the level of detail:
${examples.map(example).join('\n')}${voiceList}`;
}

/**
 * A demo call the rep has read, to practise the same call: who the prospect
 * was in it, and every line they said, so she gives the same facts.
 */
export interface ModelCall {
  prospect: {
    name: string;
    role: string;
    company: string;
    difficulty: Difficulty;
    gender: DemoGender;
  };
  /** The prospect's lines in the demo, in order. */
  lines: readonly string[];
}

export function buildProspectWriterUserPrompt(description: string, modelCall?: ModelCall): string {
  const ask = `The rep's description of her:
"""
${description.trim()}
"""`;
  if (!modelCall)
    return `${ask}

Write this prospect.`;
  const { prospect, lines } = modelCall;
  const who =
    prospect.gender === 'male'
      ? `In the model call the prospect is a man, ${prospect.name}, ${prospect.role} at ${prospect.company}. The app's prospects are women, so she has his job, his company and his situation, and a woman's name to match.`
      : `Keep her name: ${prospect.name}, ${prospect.role} at ${prospect.company}.`;
  return `${ask}

The rep has read a model call to this person and wants to practise the same call. Keep her consistent with it: her job, her company, her situation, how hard she is to win (${prospect.difficulty}), and every fact she gives away in it. Her private facts are the ones the model call uncovers. ${who}

What the prospect says in the model call:
${lines.map((line) => `- "${line}"`).join('\n')}

Write this prospect.`;
}

/** A kebab-case id from her name and a random suffix: "rachel-byrne-4f2a9c". */
export function prospectId(name: string, suffix: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return `${slug || 'prospect'}-${suffix}`;
}

const clean = (text: string) => text.trim();
const list = (items: readonly string[], max: number) =>
  items.map(clean).filter(Boolean).slice(0, max);

/**
 * The scenario for a draft. `templates` are the shipped scenarios: the one of
 * the draft's difficulty (or the first, if none is) lends its thresholds, win
 * condition and rubric. Throws a ProspectDraftError if the result is not a
 * valid ScenarioSpec, such as a draft with no pains or no objections.
 */
export function scenarioFromDraft(
  draft: ProspectDraft & { voiceId?: string },
  options: {
    id: string;
    templates: readonly ScenarioSpec[];
    /** Wins over the draft's: practising a demo's call, she is as hard to win as in it. */
    difficulty?: Difficulty;
  },
): ScenarioSpec {
  const difficulty = options.difficulty ?? draft.difficulty;
  const template =
    options.templates.find((s) => s.difficulty === difficulty) ?? options.templates[0];
  if (!template) throw new ProspectDraftError('There is no shipped scenario to base her on.');
  const { prospect } = draft;
  const parsed = ScenarioSpec.safeParse({
    id: options.id,
    version: 1,
    title: clean(draft.title),
    difficulty,
    locale: draft.locale,
    prospect: {
      name: clean(prospect.name),
      role: clean(prospect.role),
      company: clean(prospect.company),
      companyFacts: clean(prospect.companyFacts),
      personality: clean(prospect.personality),
      speakingStyle: clean(prospect.speakingStyle),
      openingLine: clean(prospect.openingLine),
      hidden: {
        pains: list(prospect.hidden.pains, 3),
        currentSolution: clean(prospect.hidden.currentSolution),
        decisionProcess: clean(prospect.hidden.decisionProcess),
        timing: clean(prospect.hidden.timing),
      },
      objections: list(prospect.objections, 5),
    },
    voice: {
      provider: 'cartesia',
      voiceId: draft.voiceId ?? VOICE_ID_PLACEHOLDER,
      speed: draft.voice.speed,
      hint: clean(draft.voice.hint) || undefined,
    },
    state: template.state,
    winCondition: template.winCondition,
    rubricId: template.rubricId,
  });
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`);
    throw new ProspectDraftError(
      `The prospect Claude wrote is incomplete: ${problems.join('; ')}.`,
    );
  }
  return parsed.data;
}
