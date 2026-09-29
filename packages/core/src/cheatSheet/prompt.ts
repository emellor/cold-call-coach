// A cheat sheet, written in one request: Claude, as a sales coach, writes the
// page of notes a rep keeps in front of them on a real call, from the rep's
// profile of the person they're about to call. Every line is short enough to
// read at a glance mid-conversation and to say as it is. The system prompt is
// the same for every sheet, so it caches; the profile goes in the user turn.
import type { CheatSheetDraft, CheatSheetReply, ProductSpec, RubricSpec } from '@ccc/contracts';

/** Room for the sheet as JSON (about 1k tokens) and the thinking before it. */
export const CHEAT_SHEET_MAX_TOKENS = 8_192;

export function buildCheatSheetSystemPrompt(input: {
  product: ProductSpec;
  rubric: RubricSpec;
}): string {
  const { product, rubric } = input;
  const scorecard = rubric.criteria.map((c) => `- ${c.name}: ${c.anchors['5']}`).join('\n');
  return `You are a sales coach writing a one-page cheat sheet that a rep keeps in front of them during a live cold call. They glance at it mid-conversation, so every line is a short phrase they can say as it is: no paragraphs, no explanations, no advice about technique.

The rep sells ${product.name}: ${product.oneLiner}. What it offers: ${product.valuePoints.join('; ')}. Ideal customer: ${product.idealCustomer}. The goal of a call: ${product.callGoal}, unless the profile sets another objective. Never claim anything about ${product.name} beyond these facts: where a line would need a figure you don't have, such as a price, write it so it doesn't.

The lines should sound like a 10/10 call on this scorecard:
${scorecard}

Write:
- title: who the call is to and the business, like "Sarah Patel, Carewell".
- goal: the one thing the rep wants from this call, in under ten words.
- opener: one or two lines to open the call: name and company, then earning the next thirty seconds.
- reason: why the rep is calling, in the prospect's terms: a problem someone in their role would recognise, in one or two short sentences.
- questions: four to six open questions, one idea each and under fifteen words, in the order a call would reach them.
- theirQuestions: three to five questions they are likely to ask, such as what it is, how you got their number, or what it costs, each with an honest answer.
- objections: four to six objections they are likely to raise, in their words, each with a reply that acknowledges it and asks a question back.
- valueLines: two or three problems they may mention, each with one line tying ${product.name} to it.
- close: one or two lines asking for the next step with a specific day and time, then confirming it back.
- voicemail: a voicemail under forty words: who is calling, one reason in their terms, and what to do next.

Every line must be readable in two seconds. Use the spelling of the prospect's country: British English unless the profile says otherwise.`;
}

export function buildCheatSheetUserPrompt(input: { brief: string }): string {
  return `The rep's profile of the person they are about to call, in their own words: who they are, the business, and what the rep wants from the call.

<profile>
${input.brief.trim()}
</profile>

Write the cheat sheet for this call.`;
}

/** A draft that doesn't make a sheet worth keeping. */
export class CheatSheetError extends Error {
  override name = 'CheatSheetError';
}

const lines = (items: readonly string[], max: number) =>
  items
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);

const replies = (items: readonly CheatSheetReply[], max: number) =>
  items
    .map((r) => ({ they: r.they.trim(), you: r.you.trim() }))
    .filter((r) => r.they && r.you)
    .slice(0, max);

/**
 * The draft cleaned into a sheet: blank lines dropped and each list capped at
 * what fits on one page. Throws CheatSheetError when there is no opener, fewer
 * than two questions, or no close.
 */
export function cheatSheetFrom(draft: CheatSheetDraft): CheatSheetDraft {
  const sheet: CheatSheetDraft = {
    title: draft.title.trim() || 'Your call',
    goal: draft.goal.trim(),
    opener: lines(draft.opener, 2),
    reason: draft.reason.trim(),
    questions: lines(draft.questions, 6),
    theirQuestions: replies(draft.theirQuestions, 5),
    objections: replies(draft.objections, 6),
    valueLines: replies(draft.valueLines, 3),
    close: lines(draft.close, 2),
    voicemail: draft.voicemail.trim(),
  };
  if (!sheet.opener.length || sheet.questions.length < 2 || !sheet.close.length) {
    throw new CheatSheetError(
      'The cheat sheet Claude wrote is missing its opener, questions or close. Try again.',
    );
  }
  return sheet;
}
