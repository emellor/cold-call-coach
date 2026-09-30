// A reverse call's notes, written in one request once the call is over: Claude,
// as a sales trainer, annotates Sam's side so the rep, who played the prospect,
// can study what he said and why. The system prompt is the same for every call,
// so it caches; the transcript goes in the user turn.
import type {
  CallOutcome,
  ProductSpec,
  RepNotes,
  RepNotesDraft,
  ScenarioSpec,
  Speaker,
} from '@ccc/contracts';
import { expertPlaybook } from './playbook.ts';
import { REP_NAME } from './systemPrompt.ts';

/** Room for the notes as JSON (1–2k tokens) and the thinking before them. */
export const REP_NOTES_MAX_TOKENS = 8_192;

export function buildRepNotesSystemPrompt(input: { product: ProductSpec }): string {
  const { product } = input;
  return `You are a sales trainer. A trainee rep played a prospect on a practice phone call, and ${REP_NAME}, an expert rep, made a live cold call to her, selling ${product.name}: ${product.oneLiner}. What it offers: ${product.valuePoints.join('; ')}. The goal of the call: ${product.callGoal}. ${REP_NAME} knew only her name, role and company before calling.

The trainee wants to learn from ${REP_NAME}'s side of the call. How an expert plays it:
${expertPlaybook(product.name)}

For each of ${REP_NAME}'s lines, in order: name the technique in two to five words, and say in one sentence why it works at that point of the call, referring to what she had just said. Be honest: the call was live, so where a line was a misstep, name it as one and say in the note what would have worked better.

Then write a summary of two or three sentences (how the call went, and what ${REP_NAME} did that decided it) and three to five lessons: patterns from ${REP_NAME}'s side that a trainee should copy on their own calls.`;
}

const ENDINGS: Record<CallOutcome, string> = {
  meeting_booked: `${REP_NAME} booked the meeting`,
  hung_up_by_prospect: 'She ended the call',
  ended_by_rep: `${REP_NAME} ended the call`,
  timeout: 'The 15-minute limit ended it',
  error: 'It was cut off by an error',
};

export interface RepNotesTurn {
  speaker: Speaker;
  text: string;
}

export function buildRepNotesUserPrompt(input: {
  scenario: ScenarioSpec;
  turns: readonly RepNotesTurn[];
  outcome: CallOutcome;
  outcomeReason: string | null;
}): string {
  const { scenario, turns, outcome, outcomeReason } = input;
  const { prospect } = scenario;
  const herName = prospect.name.split(' ')[0] ?? prospect.name;
  const transcript = turns
    .map((t, i) => `${i + 1}. ${t.speaker === 'rep' ? REP_NAME : herName}: ${t.text}`)
    .join('\n');
  const samTurns = turns.flatMap((t, i) => (t.speaker === 'rep' ? [i + 1] : []));
  const ending = ENDINGS[outcome] + (outcomeReason ? `: ${outcomeReason}` : '');
  return `The prospect the trainee played: ${prospect.name}, ${prospect.role} at ${prospect.company}.
How the call ended: ${ending}.

The call, numbered by turn:
${transcript}

Write the notes for ${REP_NAME}'s lines: turns ${samTurns.join(', ')}.`;
}

/** Notes that don't make anything worth showing. */
export class RepNotesError extends Error {
  override name = 'RepNotesError';
}

const MAX_LESSONS = 5;

/**
 * The draft cleaned into notes: each note on one of Sam's lines (the first for
 * a line wins), trimmed and in turn order; blank lessons dropped and at most
 * five kept. Throws RepNotesError when Sam spoke and no note is left.
 */
export function repNotesFrom(draft: RepNotesDraft, turns: readonly RepNotesTurn[]): RepNotes {
  const samTurns = new Set(turns.flatMap((t, i) => (t.speaker === 'rep' ? [i + 1] : [])));
  const kept = new Map<number, RepNotes['notes'][number]>();
  for (const n of draft.notes) {
    const turn = Math.round(n.turn);
    const technique = n.technique.trim();
    const note = n.note.trim();
    if (!samTurns.has(turn) || kept.has(turn) || !technique || !note) continue;
    kept.set(turn, { turn, technique, note });
  }
  if (samTurns.size > 0 && kept.size === 0) {
    throw new RepNotesError(
      `The notes Claude wrote didn't match any of ${REP_NAME}'s lines. Try again.`,
    );
  }
  return {
    notes: [...kept.values()].sort((a, b) => a.turn - b.turn),
    summary: draft.summary.trim(),
    lessons: draft.lessons
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, MAX_LESSONS),
  };
}
