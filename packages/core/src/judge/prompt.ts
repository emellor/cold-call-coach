// The judge's prompt (PLAN.md §6.3). It sees the product, the prospect's
// private facts, her current state and the last few turns, and scores only the
// rep's latest turn. The system part is fixed for the call so it caches.
import type { ProductSpec, ProspectState, ScenarioSpec } from '@ccc/contracts';
import type { TranscriptTurn } from '../prospect/messages.ts';
import { privateFacts } from '../prospect/facts.ts';

/** How many turns (both speakers) of context the judge sees, the latest rep turn included. */
export const JUDGE_WINDOW_TURNS = 6;

export function buildJudgeSystemPrompt(scenario: ScenarioSpec, product: ProductSpec): string {
  const { prospect } = scenario;
  const facts = privateFacts(prospect.hidden)
    .map((f) => `- ${f.key}: ${f.text}`)
    .join('\n');
  return `You judge a sales rep's cold call, one turn at a time. The rep is practising on a simulated prospect. After each rep turn you report what that turn did, as a fixed set of true/false signals. Code turns your signals into the prospect's patience and interest, so be literal: mark a signal true only when the rep's latest turn clearly shows it, and never to be kind or harsh.

What the rep sells (the prospect knows none of this until told):
- ${product.name}: ${product.oneLiner}
- Value: ${product.valuePoints.join('; ')}
- Ideal customer: ${product.idealCustomer}
- The call's goal: ${product.callGoal}

The prospect: ${prospect.name}, ${prospect.role} at ${prospect.company} (${prospect.companyFacts}).
Her private facts, which the rep earns only by asking about them:
${facts}

How to judge the rep's LATEST turn (earlier turns are context only):
- askedPermission: asks for a moment of her time ("have you got thirty seconds?").
- gaveRelevantReason: ties the call to a problem someone in her role would recognise. A company introduction or a list of features is not a reason.
- askedOpenQuestion: asks at least one open question (what, how, why, tell me, walk me through). Yes/no questions don't count.
- followedUp: builds on something she said in her previous turn, rather than moving on to the rep's own agenda.
- acknowledgedObjection: she objected or pushed back in her previous turn, and the rep acknowledges it before responding.
- pitchedFeatures: describes product features or capabilities that aren't tied to something she has said.
- ignoredHerPoint: she raised a question, objection or point in her previous turn and this turn doesn't address it.
- pushy: presses on after she has said no or asked to go, or pressures her.
- rude: insulting, sarcastic at her expense, dismissive or hostile.
- askedForMeeting: asks for a meeting, call or demo. Offering to send information is not a meeting ask.
- proposedSpecificTime: names a specific day and a time ("Tuesday at ten"). "Sometime next week" is not specific.
- revealEarned: the key of the one private fact this turn earned with a relevant, open question aimed at it. null if no question was aimed at a fact, if the question was generic, closed or leading, or if that fact is already revealed.
- stage: where the call is, judging by this turn: opener (introductions, permission), reason (why they're calling), discovery (asking about her situation), pitch (explaining the product), objection_handling (answering her pushback), close (asking for the meeting or next step), other.
- tip: one short, specific tip for the rep right now, at most 15 words, or null if the turn was fine. Severity "warn" only for something hurting the call.`;
}

export function buildJudgeUserPrompt(input: {
  turns: readonly TranscriptTurn[];
  state: ProspectState;
}): string {
  const { turns, state } = input;
  const lastRep = turns.findLastIndex((t) => t.speaker === 'rep');
  if (lastRep === -1) throw new Error('the judge needs a rep turn to judge');
  const recent = turns.slice(0, lastRep + 1).slice(-JUDGE_WINDOW_TURNS);
  const lines = recent.map((turn, i) => {
    const who = turn.speaker === 'rep' ? 'Rep' : 'Prospect';
    const cut = turn.interrupted ? ' [cut off by the rep]' : '';
    return i === recent.length - 1 ? `LATEST ${who}: ${turn.text}` : `${who}: ${turn.text}${cut}`;
  });
  const revealed = state.painsRevealed.length ? state.painsRevealed.join(', ') : 'none';
  return `Her state before this turn: interest ${Math.round(state.interest)}/100, patience ${Math.round(state.patience)}/100. Private facts already revealed: ${revealed}.

The call so far (oldest first):
${lines.join('\n')}

Judge the LATEST rep turn.`;
}
