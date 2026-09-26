// The Hint button's prompt (PLAN.md §8.3): three short lines the rep could
// say next. The coach sees only what the rep could know (the product, who she
// is, the call so far), never her private facts or hidden state, so a hint
// can't hand the rep something they haven't earned.
import type { ProductSpec, ScenarioSpec } from '@ccc/contracts';
import type { TranscriptTurn } from '../prospect/messages.ts';

/** How many turns (both speakers) of the call the hint sees. */
export const HINT_WINDOW_TURNS = 8;
/** Room for three short lines and any adaptive thinking at low effort. */
export const HINT_MAX_TOKENS = 1024;

export function buildHintSystemPrompt(scenario: ScenarioSpec, product: ProductSpec): string {
  const { prospect } = scenario;
  return `You coach a sales rep live, during a practice cold call. The rep has asked for a hint: suggest what they could say next, as lines they can read out as they are.

What the rep sells:
- ${product.name}: ${product.oneLiner}
- Value: ${product.valuePoints.join('; ')}
- Ideal customer: ${product.idealCustomer}
- The call's goal: ${product.callGoal}

They are calling ${prospect.name}, ${prospect.role} at ${prospect.company}. A win on this call: ${scenario.winCondition}.

Good cold calls: permission and a relevant reason early; open questions (what, how, why) that follow up on what she says; acknowledge an objection before answering it; ask for a meeting at a specific day and time once she is interested. Keep the rep talking less than her.

Write exactly three different lines, best first, each at most 20 words, in the rep's voice, in plain spoken English. Each should respond to what she last said. Use only what the call has revealed: don't invent facts about her or her company.`;
}

export function buildHintUserPrompt(turns: readonly TranscriptTurn[]): string {
  const recent = turns.slice(-HINT_WINDOW_TURNS);
  const lines = recent.map((turn) => {
    const who = turn.speaker === 'rep' ? 'Rep' : 'Prospect';
    const cut = turn.interrupted ? ' [cut off by the rep]' : '';
    return `${who}: ${turn.text}${cut}`;
  });
  const call = lines.length ? lines.join('\n') : '(Nothing has been said yet.)';
  return `The call so far (oldest first):
${call}

Suggest three lines the rep could say next.`;
}

const normal = (line: string) => line.toLowerCase().replace(/\s+/g, ' ').trim();

/** The lines to show: trimmed, surrounding quotes removed, blanks and repeats dropped, at most three. */
export function hintSuggestions(lines: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw
      .trim()
      .replace(/^["“'‘]+|["”'’]+$/g, '')
      .trim();
    const key = normal(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length === 3) break;
  }
  return out;
}
