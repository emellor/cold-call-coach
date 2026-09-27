// The Get help button's prompt (PLAN.md §8.3, where it was the Hint): the exact
// words the rep should say next, why they fit this point of the call, and what to
// say if she pushes back. The coach sees only what the rep could know (the
// product, who she is, the call so far and where it has got to), never her
// private facts or hidden state, so help can't hand the rep something they
// haven't earned.
import type { HintDraft, HintResponse, ProductSpec, ScenarioSpec } from '@ccc/contracts';
import type { TranscriptTurn } from '../prospect/messages.ts';
import type { StageStatuses } from './stages.ts';

/** How many turns (both speakers) of the call the help sees. */
export const HINT_WINDOW_TURNS = 12;
/** Room for the answer and any adaptive thinking at low effort. */
export const HINT_MAX_TOKENS = 1024;

const STAGE_NAMES: Record<keyof StageStatuses, string> = {
  opener: 'Opener',
  reason: 'Reason for the call',
  discovery: 'Discovery',
  objections: 'Objections',
  next_step: 'Next step (the meeting)',
};

export function buildHintSystemPrompt(scenario: ScenarioSpec, product: ProductSpec): string {
  const { prospect } = scenario;
  return `You coach a sales rep live, during a practice cold call. The rep has pressed "Get help": tell them exactly what to say next, in words they can read out as they are, and why.

What the rep sells:
- ${product.name}: ${product.oneLiner}
- Value: ${product.valuePoints.join('; ')}
- Ideal customer: ${product.idealCustomer}
- The call's goal: ${product.callGoal}

They are calling ${prospect.name}, ${prospect.role} at ${prospect.company}. A win on this call: ${scenario.winCondition}.

A good cold call moves through these steps: an opener that asks permission; a relevant reason for the call; discovery with open questions (what, how, why) that follow up on what she says; handling objections by acknowledging them before answering; and asking for a meeting at a specific day and time once she is interested. The rep should talk less than her.

Answer with:
- say: the exact words for the rep to say next, in the rep's voice and plain spoken English, at most 35 words. They must respond to what she last said and move the call to the right next step for where it is.
- why: one short sentence naming the step of the call and the technique the line uses, so the rep learns the pattern.
- ifPushback: the words to say if she pushes back on that line, at most 30 words.

Use only what the call has revealed: don't invent facts about her or her company.`;
}

export function buildHintUserPrompt(
  turns: readonly TranscriptTurn[],
  stages?: StageStatuses,
): string {
  const recent = turns.slice(-HINT_WINDOW_TURNS);
  const lines = recent.map((turn) => {
    const who = turn.speaker === 'rep' ? 'Rep' : 'Prospect';
    const cut = turn.interrupted ? ' [cut off by the rep]' : '';
    return `${who}: ${turn.text}${cut}`;
  });
  const call = lines.length ? lines.join('\n') : '(Nothing has been said yet.)';
  const where = stages
    ? `Where the call has got to:\n${Object.entries(stages)
        .map(([stage, status]) => `- ${STAGE_NAMES[stage as keyof StageStatuses]}: ${status}`)
        .join('\n')}\n\n`
    : '';
  return `${where}The call so far (oldest first):
${call}

What should the rep say next?`;
}

const unquoted = (line: string) =>
  line
    .trim()
    .replace(/^["“'‘]+|["”'’]+$/g, '')
    .trim();

/** The help to show, cleaned: surrounding quotes removed, a blank follow-up dropped; null if nothing usable came back. */
export function helpFrom(draft: HintDraft | null | undefined): HintResponse | null {
  const say = unquoted(draft?.say ?? '');
  const why = (draft?.why ?? '').trim();
  if (!say || !why) return null;
  const ifPushback = unquoted(draft?.ifPushback ?? '');
  return ifPushback ? { say, why, ifPushback } : { say, why };
}
