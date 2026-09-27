// Writing one demo call. The expert rep (Claude) calls the prospect through
// the simulation harness, so she answers with the same prompt, judge and state
// engine as on a live call. Then Claude notes the technique behind every rep
// line, and Cartesia voices every line.
import type {
  DemoJob,
  DemoNotesDraft,
  DemoResultRequest,
  PriceTable,
  ProductSpec,
  ScenarioSpec,
} from '@ccc/contracts';
import {
  type DemoLine,
  type Effort,
  type TokenUsage,
  buildDemoNotesSystemPrompt,
  buildDemoNotesUserPrompt,
  costUsd,
  notesFrom,
  roundUsd,
  ttsCostUsd,
} from '@ccc/core';
import { demoNotesRequest } from '../claude/requests.ts';
import { usageOf } from '../judge/judge.ts';
import { cartesiaSpeed, chooseVoice, ttsLanguage } from '../scenario.ts';
import {
  type SimMessages,
  type SimModels,
  type SimResult,
  simulateCall,
} from '../simulate/harness.ts';
import { expertPersona } from '../simulate/personas.ts';
import { DEMO_TTS_MODEL, type Speech } from './speech.ts';

/** Long enough for a hard prospect; a good call books well before. */
export const DEMO_MAX_TURNS = 16;
const NOTES_TIMEOUT_MS = 120_000;
/** Lines voiced at once. */
const TTS_CONCURRENCY = 4;

export interface DemoWriterDeps {
  loadScenario(id: string): Promise<{ scenario: ScenarioSpec; product: ProductSpec }>;
  messages: SimMessages;
  /** The rep, her and the judge; `notes` writes the technique notes. */
  models: SimModels & { notes: string; notesEffort: Effort };
  speech: Speech;
  /** Her voice when her scenario has none of its own (CARTESIA_VOICE_ID). */
  fallbackVoiceId?: string;
  prices: PriceTable | null;
  logger: { info(obj: object, msg: string): void; warn(obj: object, msg: string): void };
}

/** What the demo cost, as far as the price table knows: null once anything is unpriced. */
class Spend {
  #usd: number | null = 0;
  readonly prices: PriceTable | null;
  constructor(prices: PriceTable | null) {
    this.prices = prices;
  }
  #add(usd: number | null) {
    this.#usd = this.#usd === null || usd === null ? null : this.#usd + usd;
  }
  claude(model: string, usage: TokenUsage) {
    this.#add(this.prices ? costUsd(model, usage, this.prices) : null);
  }
  tts(characters: number) {
    this.#add(this.prices ? ttsCostUsd(DEMO_TTS_MODEL, characters, this.prices) : null);
  }
  get usd() {
    return this.#usd === null ? null : roundUsd(this.#usd);
  }
}

/** The call as lines: her opening, then each rep line (with how she took it) and her reply. */
export function linesOf(scenario: ScenarioSpec, sim: SimResult): DemoLine[] {
  const lines: DemoLine[] = [{ speaker: 'prospect', text: scenario.prospect.openingLine }];
  for (const turn of sim.turns) {
    const judged = turn.judged;
    lines.push({
      speaker: 'rep',
      text: turn.rep,
      ...(judged
        ? {
            interest: [judged.before.interest, judged.after.interest] as const,
            patience: [judged.before.patience, judged.after.patience] as const,
          }
        : {}),
    });
    if (turn.prospect.trim()) lines.push({ speaker: 'prospect', text: turn.prospect.trim() });
  }
  return lines;
}

/** Runs `task` over `items`, at most `limit` at a time, keeping their order. */
async function inTurn<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>) {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await task(items[i]!);
  });
  await Promise.all(workers);
  return out;
}

export async function writeDemo(job: DemoJob, deps: DemoWriterDeps): Promise<DemoResultRequest> {
  const { messages, models, speech, logger } = deps;
  const { scenario, product } = await deps.loadScenario(job.scenarioId);
  const spend = new Spend(deps.prices);

  // A good call can still end in a hang-up; one more try gives a call worth studying.
  const simulate = () =>
    simulateCall({
      scenario,
      product,
      persona: expertPersona(job.angle),
      messages,
      models,
      maxTurns: DEMO_MAX_TURNS,
      onUsage: (_lane, model, usage) => spend.claude(model, usage),
    });
  let sim = await simulate();
  if (sim.outcome === 'hung_up_by_prospect') {
    logger.info({ demoId: job.id, detail: sim.detail }, 'demo call: she hung up; trying once more');
    sim = await simulate();
  }
  const lines = linesOf(scenario, sim);

  const message = await messages.parse(
    demoNotesRequest({
      model: models.notes,
      effort: models.notesEffort,
      system: buildDemoNotesSystemPrompt(product),
      user: buildDemoNotesUserPrompt({
        scenario,
        angle: job.angle,
        outcome: sim.outcome,
        outcomeDetail: sim.detail ?? null,
        lines,
      }),
    }),
    { signal: AbortSignal.timeout(NOTES_TIMEOUT_MS) },
  );
  spend.claude(message.model, usageOf(message));
  if (message.stop_reason === 'refusal') throw new Error('Claude declined to annotate the demo.');
  const draft = message.parsed_output as DemoNotesDraft | null;
  if (!draft) throw new Error('The demo notes came back empty.');
  const repLines = lines.filter((l) => l.speaker === 'rep').length;
  const notes = notesFrom(draft, repLines);

  const her = chooseVoice(scenario, deps.fallbackVoiceId);
  if (!her.ok) throw new Error(her.problem);
  const repVoice = await speech.repVoice();
  const language = ttsLanguage(scenario.locale);
  const herSpeed = cartesiaSpeed(scenario.voice.speed);
  const spoken = await inTurn(lines, TTS_CONCURRENCY, (line) => {
    spend.tts(line.text.length);
    return speech.speak(line.text, {
      id: line.speaker === 'rep' ? repVoice : her.voiceId,
      language,
      ...(line.speaker === 'prospect' && herSpeed !== undefined ? { speed: herSpeed } : {}),
    });
  });

  let repLine = 0;
  const turns = lines.map((line, idx) => {
    const note = line.speaker === 'rep' ? notes.lines[repLine++] : undefined;
    const voiced = spoken[idx]!;
    return {
      idx,
      speaker: line.speaker,
      text: line.text,
      technique: note?.technique ?? null,
      note: note?.note ?? null,
      interest: line.interest ? line.interest[1] : null,
      patience: line.patience ? line.patience[1] : null,
      audioMs: voiced.ms,
      audio: voiced.audio.toString('base64'),
    };
  });
  logger.info(
    { demoId: job.id, outcome: sim.outcome, lines: lines.length, costUsd: spend.usd },
    'demo call written',
  );
  return {
    scenarioVersion: scenario.version,
    title: notes.title || 'Demo call',
    summary: notes.summary,
    lessons: notes.lessons,
    outcome: sim.outcome,
    outcomeDetail: sim.detail ?? null,
    costUsd: spend.usd,
    turns,
  };
}
