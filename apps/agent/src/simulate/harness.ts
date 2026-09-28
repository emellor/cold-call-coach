// The simulation harness: plays a scripted rep against the real prospect
// prompt, judge and state engine, text only. The same ProspectBrain, tools
// and request builders as a live call; only the voice pipeline is missing.
// scripts/simulate-call.ts runs it by hand, and the demo worker (demos/) runs
// it to write the demo calls, which is why it lives in the agent.
import type { ProductSpec, ProspectState, ScenarioSpec } from '@ccc/contracts';
import {
  type Effort,
  type TokenUsage,
  type TranscriptTurn,
  buildProspectMessages,
  buildProspectSystemPrompt,
  modelCapabilities,
  withStateNote,
} from '@ccc/core';
import type { BetaMessage, MessageCreateParamsNonStreaming } from '../claude/client.ts';
import { prospectRequest } from '../claude/requests.ts';
import { type StreamingMessages, claudeTextStream } from '../claude/textStream.ts';
import { type ParsingMessages, claudeJudge, usageOf } from '../judge/judge.ts';
import { actOnReply } from '../prospect/actions.ts';
import { type JudgedTurn, ProspectBrain } from '../prospect/brain.ts';
import type { Reply } from '../prospect/replies.ts';
import { type ProspectAction, actionsFromMessage, closingLine } from '../prospect/tools.ts';
import type { RepPersona } from './personas.ts';

/** The slice of `client.beta.messages` the simulation uses; fakes satisfy it in tests. */
export interface SimMessages extends StreamingMessages, ParsingMessages {
  create(params: MessageCreateParamsNonStreaming): PromiseLike<BetaMessage>;
}

export interface SimModels {
  rep: string;
  prospect: string;
  prospectEffort: Effort;
  coach: string;
  coachEffort: Effort;
}

export type SimOutcome = 'meeting_booked' | 'hung_up_by_prospect' | 'no_decision';

/** Which of the simulation's Claude calls some usage was for. */
export type SimLane = 'rep' | 'prospect' | 'judge';

export interface SimTurn {
  turn: number;
  rep: string;
  prospect: string;
  actions: ProspectAction[];
  /** The judgement of this rep turn (it shapes her next reply, not this one). */
  judged: JudgedTurn | undefined;
}

export interface SimResult {
  outcome: SimOutcome;
  /** The agreed slot, or why she hung up. */
  detail?: string;
  turns: SimTurn[];
  final: ProspectState;
  usage: Usage;
}

export interface Usage {
  calls: number;
  inputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
}

/** 150 words a minute: how long a rep turn would take to say. */
export const speakingSeconds = (text: string): number =>
  text.split(/\s+/).filter(Boolean).length / 2.5;

/** A rep line and the thinking before it at low effort, as for her replies. */
const REP_MAX_TOKENS = 1_024;

function addUsage(usage: Usage, message: Pick<BetaMessage, 'usage'>): void {
  usage.calls += 1;
  usage.inputTokens += message.usage.input_tokens;
  usage.cacheReadInputTokens += message.usage.cache_read_input_tokens ?? 0;
  usage.outputTokens += message.usage.output_tokens;
}

/** The call from the rep's side: her lines are the user turns. */
function repView(turns: readonly TranscriptTurn[]) {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const turn of turns) {
    const role = turn.speaker === 'prospect' ? 'user' : 'assistant';
    const last = messages.at(-1);
    if (last?.role === role) last.content = `${last.content} ${turn.text}`;
    else messages.push({ role, content: turn.text });
  }
  return messages;
}

/** Claude's rep line, minus any speaker label or wrapping quotes it adds anyway. */
const cleanRepLine = (text: string): string =>
  text
    .trim()
    .replace(/^(rep|me|you)\s*:\s*/i, '')
    .replace(/^"(.*)"$/s, '$1')
    .trim();

async function collect(stream: AsyncIterable<string>): Promise<string> {
  let text = '';
  for await (const chunk of stream) text += chunk;
  return text.trim();
}

export async function simulateCall(options: {
  scenario: ScenarioSpec;
  product: ProductSpec;
  persona: RepPersona;
  messages: SimMessages;
  models: SimModels;
  maxTurns: number;
  onTurn?: (turn: SimTurn) => void;
  /** Every answered Claude call's usage, by lane and the model that answered (for pricing). */
  onUsage?: (lane: SimLane, model: string, usage: TokenUsage) => void;
}): Promise<SimResult> {
  const { scenario, product, persona, messages, models, maxTurns, onTurn, onUsage } = options;
  const usage: Usage = { calls: 0, inputTokens: 0, cacheReadInputTokens: 0, outputTokens: 0 };
  const usageLogger = {
    info: (obj: object, msg: string) => {
      if (msg !== 'claude usage') return;
      const u = obj as {
        inputTokens?: number;
        cacheReadInputTokens?: number;
        outputTokens?: number;
      };
      usage.calls += 1;
      usage.inputTokens += u.inputTokens ?? 0;
      usage.cacheReadInputTokens += u.cacheReadInputTokens ?? 0;
      usage.outputTokens += u.outputTokens ?? 0;
    },
    warn: () => {},
  };

  const brain = new ProspectBrain({
    scenario,
    product,
    judge: claudeJudge({
      messages,
      model: models.coach,
      effort: models.coachEffort,
      logger: usageLogger,
      onUsage: (model, u) => onUsage?.('judge', model, u),
    }),
    logger: usageLogger,
  });
  const persona_ = persona.system(scenario, product);
  const herPrompt = buildProspectSystemPrompt(scenario);
  const repCaps = modelCapabilities(models.rep);

  const transcript: TranscriptTurn[] = [
    { speaker: 'prospect', text: scenario.prospect.openingLine },
  ];
  const turns: SimTurn[] = [];
  let outcome: SimOutcome = 'no_decision';
  let detail: string | undefined;
  const controller = {
    recordMeeting: (when: string) => {
      outcome = 'meeting_booked';
      detail = when;
      return Promise.resolve();
    },
    end: (_endedBy: string, reason?: string) => {
      if (outcome !== 'meeting_booked') {
        outcome = 'hung_up_by_prospect';
        detail = reason;
      }
      return Promise.resolve();
    },
  };
  let ended = false;

  for (let n = 1; n <= maxTurns && !ended; n++) {
    // The rep speaks.
    const repReply = await messages.create({
      model: models.rep,
      max_tokens: REP_MAX_TOKENS,
      system: persona_,
      messages: repView(transcript),
      ...(repCaps.effort ? { output_config: { effort: 'low' as const } } : {}),
    });
    addUsage(usage, repReply);
    onUsage?.('rep', repReply.model, usageOf(repReply));
    const rep = cleanRepLine(
      repReply.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join(' '),
    );
    transcript.push({ speaker: 'rep', text: rep || '(silence)' });
    const turn = brain.repTurn(transcript.slice(), {
      longestMonologueSec: speakingSeconds(rep),
    });

    // Her reply is written under the note as it stood once the rep's PREVIOUS
    // turn was judged: in a live call the judge finishes while the rep is still
    // talking, so this is the design's one-turn lag, made deterministic.
    if (turn > 1) await brain.judged(turn - 1);
    const reply: Reply = { id: `sim-${turn}`, forcedGoodbye: brain.hangUpDue, actions: [] };
    const her = await collect(
      claudeTextStream({
        messages,
        params: prospectRequest({
          model: models.prospect,
          effort: models.prospectEffort,
          persona: herPrompt,
          messages: withStateNote(
            buildProspectMessages(transcript),
            brain.note(),
            modelCapabilities(models.prospect),
          ),
        }),
        onComplete: (message) => {
          addUsage(usage, message);
          onUsage?.('prospect', message.model, usageOf(message));
          reply.actions = actionsFromMessage(message);
        },
        closingText: (_m, spoke) => (spoke ? undefined : closingLine(reply.actions)),
      }),
    );
    transcript.push({ speaker: 'prospect', text: her });

    // Heard in full (no barge-in in text), so her tools act, as on a live call.
    await actOnReply(reply, turn, { brain, controller, logger: { info: () => {} } });
    ended = outcome !== 'no_decision';

    const record: SimTurn = {
      turn,
      rep,
      prospect: her,
      actions: reply.actions,
      judged: await brain.judged(turn),
    };
    turns.push(record);
    onTurn?.(record);
  }

  await brain.settled();
  return { outcome, detail, turns, final: brain.state, usage };
}
