// A demo call, written in one request: Claude, as a sales trainer, writes a
// model cold call to one of the prospects (an expert rep taking a given
// approach, and her answering as her profile says) with the technique behind
// every line the rep says. The system prompt is the same for every demo, so it
// caches across a batch; the prospect and the approach go in the user turn.
import type {
  DemoScriptDraft,
  ProductSpec,
  RubricSpec,
  ScenarioSpec,
  Speaker,
} from '@ccc/contracts';
import { privateFacts } from '../prospect/facts.ts';
import { languageName } from '../prospect/systemPrompt.ts';

/** Room for the call as JSON (2–3k tokens) and the thinking before it. */
export const DEMO_SCRIPT_MAX_TOKENS = 16_000;

/** Fewer lines than this is not a call worth studying. */
export const MIN_DEMO_LINES = 8;

export function buildDemoScriptSystemPrompt(input: {
  product: ProductSpec;
  rubric: RubricSpec;
}): string {
  const { product, rubric } = input;
  const scorecard = rubric.criteria.map((c) => `- ${c.name}: ${c.anchors['5']}`).join('\n');
  return `You are a sales trainer writing a model cold call for trainee reps to read and learn from: a 10/10 call, the best version of this call a real rep could make.

The caller is an expert B2B rep selling ${product.name}: ${product.oneLiner}. What it offers: ${product.valuePoints.join('; ')}. Ideal customer: ${product.idealCustomer}. The goal of the call: ${product.callGoal}. The rep never claims anything about ${product.name} beyond these facts.

A 10/10 on the scorecard trainees are marked against:
${scorecard}

How the expert plays it:
- Opens with name and company, then earns the next thirty seconds: a permission ask, or an upfront agreement.
- Gives a reason for the call in her terms: a problem someone in her role would recognise. Never leads with features.
- Discovery: open questions, one at a time, following up on her exact words until she says what the problem costs her. She does most of the talking.
- Objections: acknowledges, asks a question to understand, answers briefly, checks it landed. Never argues.
- Ties one relevant point about ${product.name} to a problem only after she has named it, in a sentence.
- Closes with a specific day and time for the call, and confirms it back when she agrees.
- Sounds human: warm, confident, unhurried; one to three short sentences a turn.

She is a real person, not a pushover. She speaks as her profile says, raises her objections where they fit, and shares a private fact only when a question has earned it. The rep wins her round by skill, not because she gives in. The call ends with the meeting booked for a specific day and time, and her agreeing must be believable.

Write it as a phone call: spoken words only, no stage directions, about 18 to 30 lines in all (three to five minutes). Her first line is her answering the phone, word for word as given.

For every rep line, name the technique in two to five words and say in one sentence why it works at that point of the call, referring to what she has just said. Her lines get null for both. Then give the meeting as agreed, a short title naming what the call shows, a summary of two or three sentences, and three to five lessons: patterns a trainee should copy on their own calls.`;
}

export function buildDemoScriptUserPrompt(input: {
  scenario: ScenarioSpec;
  angle: string;
}): string {
  const { scenario, angle } = input;
  const { prospect } = scenario;
  const facts = privateFacts(prospect.hidden)
    .map((f) => `- ${f.label}: ${f.text}`)
    .join('\n');
  return `The prospect: ${prospect.name}, ${prospect.role} at ${prospect.company} (${prospect.companyFacts}).
How hard she is to win: ${scenario.difficulty}.
Personality: ${prospect.personality}.
How she speaks: ${prospect.speakingStyle}.
She answers the phone with: "${prospect.openingLine}"
Objections she raises, in her own words, where they fit: ${prospect.objections.join('; ')}.
Her private facts, which the rep has to earn with the right questions:
${facts}

The rep's approach for this call: ${angle}

Write the call in ${languageName(scenario.locale)}.`;
}

export interface DemoScriptLine {
  speaker: Speaker;
  text: string;
  technique: string | null;
  note: string | null;
}

export interface DemoScript {
  lines: DemoScriptLine[];
  /** The meeting she agreed to, as confirmed on the call. */
  meeting: string | null;
  title: string | null;
  summary: string;
  lessons: string[];
}

/** A draft that doesn't make a demo worth storing. */
export class DemoScriptError extends Error {
  override name = 'DemoScriptError';
}

const clean = (value: string | null): string | null => value?.trim() || null;

/**
 * The draft cleaned into a call: blank lines dropped, two lines in a row from
 * one side joined into one turn, notes kept on the rep's lines only, her
 * opening line put first if Claude left it out, and at most five lessons.
 * Throws DemoScriptError when what is left is too short to study.
 */
export function scriptFrom(draft: DemoScriptDraft, scenario: ScenarioSpec): DemoScript {
  const lines: DemoScriptLine[] = [];
  for (const raw of draft.lines) {
    const text = raw.text.trim();
    if (!text) continue;
    const rep = raw.speaker === 'rep';
    const technique = rep ? clean(raw.technique) : null;
    const note = rep ? clean(raw.note) : null;
    const previous = lines.at(-1);
    if (previous?.speaker === raw.speaker) {
      previous.text = `${previous.text} ${text}`;
      previous.technique ??= technique;
      previous.note ??= note;
      continue;
    }
    lines.push({ speaker: raw.speaker, text, technique, note });
  }
  if (lines[0]?.speaker !== 'prospect') {
    lines.unshift({
      speaker: 'prospect',
      text: scenario.prospect.openingLine,
      technique: null,
      note: null,
    });
  }
  const repLines = lines.filter((l) => l.speaker === 'rep').length;
  if (lines.length < MIN_DEMO_LINES || repLines < 3) {
    throw new DemoScriptError(
      `The call Claude wrote is too short to study (${lines.length} lines). Retry it.`,
    );
  }
  return {
    lines,
    meeting: clean(draft.meeting),
    title: clean(draft.title),
    summary: draft.summary.trim(),
    lessons: draft.lessons
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 5),
  };
}
