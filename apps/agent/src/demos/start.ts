// Starts the demo worker with the agent's own settings. main.ts calls it in
// the main process only, never in a call's job process.
import { createClaude } from '../claude/client.ts';
import type { CallConfig } from '../config.ts';
import { readPriceTable } from '../prices.ts';
import { fetchScenario } from '../scenario.ts';
import { demoQueue } from './api.ts';
import { cartesiaSpeech } from './speech.ts';
import { type DemoWorker, type DemoWorkerLogger, startDemoWorker } from './worker.ts';
import { writeDemo } from './write.ts';

/** The notes on a demo call are worth more thought than a live judgement. */
const NOTES_EFFORT = 'medium';

/** One line per event in the agent's log, errors by their message. */
const consoleLogger: DemoWorkerLogger = (() => {
  const line = (obj: object, msg: string) =>
    `[demos] ${msg} ${JSON.stringify(obj, (_key, value: unknown) =>
      value instanceof Error ? value.message : value,
    )}`;
  return {
    info: (obj, msg) => console.log(line(obj, msg)),
    warn: (obj, msg) => console.warn(line(obj, msg)),
    error: (obj, msg) => console.error(line(obj, msg)),
  };
})();

export async function startDemos(config: CallConfig): Promise<DemoWorker> {
  const claude = createClaude(config.ANTHROPIC_API_KEY, config.ANTHROPIC_WORKSPACE_ID);
  const priced = await readPriceTable();
  const api = { apiBaseUrl: config.API_BASE_URL, secret: config.INTERNAL_API_SECRET };
  const speech = cartesiaSpeech({
    apiKey: config.CARTESIA_API_KEY,
    ...(config.DEMO_REP_VOICE_ID ? { repVoiceId: config.DEMO_REP_VOICE_ID } : {}),
    ...(config.CARTESIA_VOICE_ID ? { fallbackVoiceId: config.CARTESIA_VOICE_ID } : {}),
  });
  return startDemoWorker({
    queue: demoQueue(api),
    logger: consoleLogger,
    write: (job) =>
      writeDemo(job, {
        loadScenario: (scenarioId) => fetchScenario({ ...api, scenarioId }),
        messages: claude.beta.messages,
        models: {
          rep: config.DEMO_MODEL,
          prospect: config.PROSPECT_MODEL,
          prospectEffort: config.PROSPECT_EFFORT,
          coach: config.COACH_MODEL,
          coachEffort: config.COACH_EFFORT,
          notes: config.DEMO_MODEL,
          notesEffort: NOTES_EFFORT,
        },
        speech,
        ...(config.CARTESIA_VOICE_ID ? { fallbackVoiceId: config.CARTESIA_VOICE_ID } : {}),
        prices: priced.ok ? priced.prices : null,
        logger: consoleLogger,
      }),
  });
}
