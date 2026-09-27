// The notes on a demo call: Claude, as a sales trainer, names the technique
// behind every rep line and says why it works at that point, then titles the
// call and draws its lessons. The trainee reads them as the call plays.
import type {
  DemoNotesDraft,
  DemoOutcome,
  ProductSpec,
  ScenarioSpec,
  Speaker,
} from '@ccc/contracts';
import { privateFacts } from '../prospect/facts.ts';

export const DEMO_NOTES_MAX_TOKENS = 8_192;

export interface DemoLine {
  speaker: Speaker;
  text: string;
  /** Rep lines: how her interest and patience moved after it, when it was judged. */
  interest?: readonly [number, number];
  patience?: readonly [number, number];
}

const OUTCOME_WORDS: Record<DemoOutcome, string> = {
  meeting_booked: 'she agreed to a meeting',
  hung_up_by_prospect: 'she hung up',
  no_decision: 'it ended without a decision',
};

export function buildDemoNotesSystemPrompt(product: ProductSpec): string {
  return `You are a sales trainer annotating a model cold call for trainee reps. An expert rep called a simulated prospect to sell ${product.name}: ${product.oneLiner}. The goal of the call: ${product.callGoal}.

For every rep line, name the technique it uses and say in one sentence why it works at that point of the call, so a trainee listening along learns the pattern and not just the words. Be specific to this call: refer to what she had just said. If a rep line was weak, say so plainly in its note and what would have been better: trainees learn from that too.

Then give the call a short title naming what it shows, a summary of two or three sentences, and three to five lessons: patterns a trainee should copy on their own calls.`;
}

const moved = (label: string, [before, after]: readonly [number, number]) =>
  `${label} ${Math.round(before)} → ${Math.round(after)}`;

export function buildDemoNotesUserPrompt(input: {
  scenario: ScenarioSpec;
  angle: string;
  outcome: DemoOutcome;
  outcomeDetail: string | null;
  lines: readonly DemoLine[];
}): string {
  const { prospect } = input.scenario;
  const facts = privateFacts(prospect.hidden)
    .map((f) => `- ${f.label}: ${f.text}`)
    .join('\n');
  let repLine = 0;
  const transcript = input.lines.map((line) => {
    if (line.speaker === 'prospect') return `Her: ${line.text}`;
    repLine += 1;
    const mood =
      line.interest && line.patience
        ? `\n    (her ${moved('interest', line.interest)}, ${moved('patience', line.patience)})`
        : '';
    return `Rep line ${repLine}: ${line.text}${mood}`;
  });
  const detail = input.outcomeDetail ? ` (${input.outcomeDetail})` : '';
  return `The prospect: ${prospect.name}, ${prospect.role} at ${prospect.company} (${prospect.companyFacts}). Personality: ${prospect.personality}.
Her private facts, which the rep had to earn with questions:
${facts}

The approach the rep was asked to take: ${input.angle}
How the call ended: ${OUTCOME_WORDS[input.outcome]}${detail}.

The call. Under a rep line, how her interest and patience (0 to 100) moved after it:
${transcript.join('\n')}

Annotate this call.`;
}

export interface DemoNotes {
  title: string;
  summary: string;
  lessons: string[];
  /** Each rep line's technique and note, by rep line number from 1; missing ones are null. */
  lines: Array<{ technique: string | null; note: string | null }>;
}

/** The draft cleaned: trimmed, at most five lessons, one entry per rep line. */
export function notesFrom(draft: DemoNotesDraft, repLines: number): DemoNotes {
  const text = (value: string) => value.trim() || null;
  return {
    title: draft.title.trim(),
    summary: draft.summary.trim(),
    lessons: draft.lessons
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 5),
    lines: Array.from({ length: repLines }, (_, i) => {
      const entry = draft.lines.find((l) => l.line === i + 1);
      return {
        technique: entry ? text(entry.technique) : null,
        note: entry ? text(entry.note) : null,
      };
    }),
  };
}
