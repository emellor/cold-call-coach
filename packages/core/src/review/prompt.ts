// The post-call review's prompt (PLAN.md §8.4): the rubric, the scenario and
// product, the measured metrics as facts, and the numbered transcript. Turn
// numbers count from 1 and are what every quote must cite.
import {
  type CallMetrics,
  type CallOutcome,
  METRIC_TARGETS,
  type ProductSpec,
  type RubricSpec,
  type ScenarioSpec,
  type Speaker,
} from '@ccc/contracts';
import { privateFacts } from '../prospect/facts.ts';
import { type ControlsUsed, anyControlsUsed } from './controls.ts';

export interface ReviewTranscriptTurn {
  speaker: Speaker;
  text: string;
  startMs: number;
  interrupted: boolean;
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
  const { prospect } = scenario;
  const facts = privateFacts(prospect.hidden)
    .map((f) => `- ${f.label}: ${f.text}`)
    .join('\n');
  const criteria = rubric.criteria
    .map(
      (c) =>
        `- ${c.key} (${c.name}): ${c.goodLooksLike}\n  1: ${c.anchors['1']}\n  3: ${c.anchors['3']}\n  5: ${c.anchors['5']}`,
    )
    .join('\n');
  return `You are an experienced B2B sales coach reviewing a practice cold call. The rep phoned a simulated prospect. You know her private facts and likely objections, so you can see what the rep uncovered and what they missed.

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

Rubric "${rubric.title}" (score each criterion 1 to 5 against its anchors):
${criteria}

Rules:
- Quote exactly. Every evidence quote, youSaid and yourResponse must be copied word for word from the transcript turn it cites. Quotes that don't match the transcript are thrown away, so if you can't quote it, don't claim it. Keep quotes short: just the words that matter.
- The delivery metrics were measured by code. They are facts: don't recount words, fillers or seconds, and don't contradict them. Score delivery from them.
- Talk to the rep in the second person, plainly and specifically. Tell them what to say, not only what to avoid; every tryInstead and better is a line they could say out loud.
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

export function buildReviewUserPrompt(input: ReviewPromptInput): string {
  const { metrics, outcome, outcomeReason, turns } = input;
  const reason = outcomeReason ? ` (${outcomeReason})` : '';
  const transcript = turns.map((turn, i) => {
    const who = turn.speaker === 'rep' ? 'Rep' : 'Prospect';
    const cut = turn.interrupted ? ' [cut off by the rep]' : '';
    return `[${i + 1}] ${who} (${clock(turn.startMs)}): ${turn.text}${cut}`;
  });
  const rewound = input.controls?.rewinds.length
    ? ' (as it stands after the retakes: rewound turns are left out)'
    : '';
  return `How the call ended: ${OUTCOME_WORDS[outcome]}${reason}.

Delivery, measured by code (facts):
${metricLines(metrics).join('\n')}
${controlLines(input.controls)}
Transcript${rewound}. Each line is [turn number] speaker (time since she answered):
${transcript.join('\n')}

Review this call.`;
}
