// The post-call review's prompt (PLAN.md §8.4): the rubric, the scenario and
// product, the measured metrics as facts, and the numbered transcript, with how
// her interest and patience moved after each rep turn. Turn numbers count from
// 1 and are what every quote must cite.
import {
  type CallMetrics,
  type CallOutcome,
  METRIC_TARGETS,
  type ProductSpec,
  type RubricSpec,
  type ScenarioSpec,
  type Speaker,
} from '@ccc/contracts';
import { type PrivateFact, privateFacts } from '../prospect/facts.ts';
import { type ControlsUsed, anyControlsUsed } from './controls.ts';
import { type TurnReaction, signalWords, stageWords } from './reactions.ts';

export interface ReviewTranscriptTurn {
  speaker: Speaker;
  text: string;
  startMs: number;
  interrupted: boolean;
  /** Rep turns: how she took it (see turnReactions). Absent if it was never judged. */
  reaction?: TurnReaction;
}

export interface ReviewPromptInput {
  rubric: RubricSpec;
  scenario: ScenarioSpec;
  product: ProductSpec;
  metrics: CallMetrics;
  outcome: CallOutcome;
  outcomeReason: string | null;
  turns: readonly ReviewTranscriptTurn[];
  /** The practice controls the rep used, from the call's events (none if absent). */
  controls?: ControlsUsed;
}

const OUTCOME_WORDS: Record<CallOutcome, string> = {
  meeting_booked: 'she agreed to a meeting',
  hung_up_by_prospect: 'she hung up',
  ended_by_rep: 'the rep hung up',
  timeout: 'it hit the 15-minute limit',
  error: 'it failed on a technical error',
};

export const clock = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function buildReviewSystemPrompt(input: ReviewPromptInput): string {
  const { rubric, scenario, product } = input;
  const { prospect, state } = scenario;
  const facts = privateFacts(prospect.hidden)
    .map((f) => `- ${f.label}: ${f.text}`)
    .join('\n');
  const criteria = rubric.criteria
    .map(
      (c) =>
        `- ${c.key} (${c.name}): ${c.goodLooksLike}\n  1: ${c.anchors['1']}\n  3: ${c.anchors['3']}\n  5: ${c.anchors['5']}`,
    )
    .join('\n');
  return `You are an experienced B2B sales coach reviewing a practice cold call. The rep phoned a simulated prospect. You know her private facts and likely objections, so you can see what the rep uncovered and what they missed. Your job is to coach: show the rep, moment by moment, what went wrong, what it cost and exactly what to say instead, so that their next call goes better.

What the rep sells:
- ${product.name}: ${product.oneLiner}
- Value: ${product.valuePoints.join('; ')}
- Ideal customer: ${product.idealCustomer}
- The call's goal: ${product.callGoal}

The prospect: ${prospect.name}, ${prospect.role} at ${prospect.company} (${prospect.companyFacts}). Personality: ${prospect.personality}.
Her private facts, which a rep earns only with relevant questions:
${facts}
Objections she was likely to raise: ${prospect.objections.join('; ')}
A win on this call: ${scenario.winCondition}.

How she decides (the simulation's rules): her interest and patience run from 0 to 100. She started at interest ${state.interest} and patience ${state.patience}. She agrees to a meeting only once her interest reaches ${state.meetingAt}, and hangs up when her patience falls to ${state.hangUpAt}; it drains a little every turn. Under each rep turn, the transcript shows how her interest and patience moved because of it, and the live judge's quick reading of the turn. The moves are facts of the simulation: use them to show what each turn did to her. The reading is an automated first opinion: disagree with it when the transcript says otherwise.

Rubric "${rubric.title}" (score each criterion 1 to 5 against its anchors):
${criteria}

How to coach:
- Walk through the call in turn order. Give every mistake and missed opportunity that mattered its own moment: say plainly what went wrong, what it cost (what she said next, or how her interest or patience moved) and the exact words to say instead at that point. Include the strong moments worth repeating, so the rep knows what to keep doing.
- Be specific to this call: name what she said and what the rep said. No generic sales advice.
- Every sayInstead, better and nextTime is words the rep could say out loud to her at that point, in their own voice. Fit each line to what she had just said and to what the rep knew by then: don't use a private fact she hadn't revealed.
- Be direct about what went wrong and constructive about fixing it. Talk to the rep in the second person, plainly.
- Quote exactly. Every evidence quote, moment quote and yourResponse must be copied word for word from the transcript turn it cites. Quotes that don't match the transcript are thrown away, so if you can't quote it, don't claim it. Keep quotes short: just the words that matter.
- The delivery metrics were measured by code. They are facts: don't recount words, fillers or seconds, and don't contradict them. Score delivery from them.
- Judge what happened on this call. Don't reward what the rep might have meant.`;
}

function metricLines(m: CallMetrics): string[] {
  const t = METRIC_TARGETS;
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return [
    `- Duration: ${clock(m.durationSec * 1000)}`,
    `- Talk ratio (rep share of speaking time): ${m.talkRatio === null ? 'n/a' : pct(m.talkRatio)} [target ${pct(t.talkRatio.min)}–${pct(t.talkRatio.max)}]`,
    `- Pace: ${m.repWpm === null ? 'n/a' : `${m.repWpm} words a minute`} [target ${t.repWpm.min}–${t.repWpm.max}]`,
    `- Core fillers (um, uh, erm, er, ah): ${m.coreFillers}${m.fillersPerMin === null ? '' : `, ${m.fillersPerMin} a minute`} [target at most ${t.fillersPerMin.max} a minute]`,
    `- Soft fillers (like, you know, basically, sort of, kind of, literally, I mean): ${m.softFillers}`,
    `- Questions: ${m.questionsOpen} open, ${m.questionsClosed} closed`,
    `- Longest monologue: ${m.longestMonologueSec} s [target at most ${t.longestMonologueSec.max} s]`,
    `- Times the rep talked over her: ${m.interruptions}`,
    `- First question asked: ${m.timeToFirstQuestionSec === null ? 'never' : `${m.timeToFirstQuestionSec} s after she answered`}`,
  ];
}

const times = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The controls section, or nothing when the rep used none. */
function controlLines(used: ControlsUsed | undefined): string {
  if (!used || !anyControlsUsed(used)) return '';
  const lines: string[] = [];
  if (used.pauses > 0) {
    const secs = Math.round(used.pausedMs / 1000);
    lines.push(
      `- Paused the call ${times(used.pauses, 'time')}${secs > 0 ? ` (${secs} s in all)` : ''}.`,
    );
  }
  if (used.hints > 0) {
    lines.push(
      `- Pressed Get help ${times(used.hints, 'time')} (it suggests the next line to say).`,
    );
  }
  for (const r of used.rewinds) {
    lines.push(
      `- Rewound: took back "${r.tookBack}" and retook it; the retake is turn ${r.beforeTurn}.`,
    );
  }
  return `
Practice controls the rep used. Coached calls allow them, so don't mark the rep down for using them; mention them where they help, such as whether a retake was better:
${lines.join('\n')}
`;
}

const moved = (label: string, [before, after]: readonly [number, number]) =>
  `${label} ${Math.round(before)} → ${Math.round(after)}`;

/** The line under a rep turn: how her mood moved, and what the live judge read in the turn. */
export function reactionLine(reaction: TurnReaction, facts: readonly PrivateFact[]): string {
  const mood = `her ${moved('interest', reaction.interest)}, ${moved('patience', reaction.patience)}`;
  const { reading } = reaction;
  if (!reading) return `→ ${mood} (the live judge didn't read this turn)`;
  const signals = reading.signals.length ? `; ${reading.signals.map(signalWords).join(', ')}` : '';
  const fact = facts.find((f) => f.key === reading.revealed);
  const earned = fact ? `; earned her private fact "${fact.label}: ${fact.text}"` : '';
  return `→ ${mood}. Judge: ${stageWords(reading.stage)}${signals}${earned}`;
}

export function buildReviewUserPrompt(input: ReviewPromptInput): string {
  const { metrics, outcome, outcomeReason, turns } = input;
  const facts = privateFacts(input.scenario.prospect.hidden);
  const reason = outcomeReason ? ` (${outcomeReason})` : '';
  const transcript = turns.map((turn, i) => {
    const who = turn.speaker === 'rep' ? 'Rep' : 'Prospect';
    const cut = turn.interrupted ? ' [cut off by the rep]' : '';
    const line = `[${i + 1}] ${who} (${clock(turn.startMs)}): ${turn.text}${cut}`;
    return turn.reaction ? `${line}\n    ${reactionLine(turn.reaction, facts)}` : line;
  });
  const rewound = input.controls?.rewinds.length
    ? ' (as it stands after the retakes: rewound turns are left out)'
    : '';
  const legend = turns.some((t) => t.reaction)
    ? " Under a rep turn, → shows how her interest and patience moved after it, and the live judge's reading of it."
    : '';
  return `How the call ended: ${OUTCOME_WORDS[outcome]}${reason}.

Delivery, measured by code (facts):
${metricLines(metrics).join('\n')}
${controlLines(input.controls)}
Transcript${rewound}. Each line is [turn number] speaker (time since she answered).${legend}
${transcript.join('\n')}

Review this call.`;
}
