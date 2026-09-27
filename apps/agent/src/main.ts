import { fileURLToPath, pathToFileURL } from 'node:url';
import { PROSPECT_AGENT_NAME } from '@ccc/contracts';
import { type JobProcess, ServerOptions, type VAD, cli, defineAgent } from '@livekit/agents';
import * as silero from '@livekit/agents-plugin-silero';
import {
  describeMissingCallConfig,
  loadDotEnv,
  readCallConfig,
  readWorkerConfig,
  turnDetectorKind,
} from './config.ts';
import { runCall } from './runCall.ts';

interface ProcessData {
  vad: VAD;
}

export default defineAgent<ProcessData>({
  prewarm: async (proc: JobProcess<ProcessData>) => {
    proc.userData.vad = await silero.VAD.load();
  },
  entry: async (ctx) => {
    await runCall(ctx, ctx.proc.userData.vad);
  },
});

// This file is also loaded inside each job's child process, where the CLI must
// not run again; only the process started as `node src/main.ts …` runs it.
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  loadDotEnv();
  const result = readWorkerConfig(process.env);
  if (!result.ok) {
    // Exit 0 so `pnpm dev` keeps the API and web running without LiveKit.
    console.warn(
      [
        "[agent] LiveKit isn't set up, so the prospect agent will not start:",
        ...result.problems.map((p) => `[agent]   - ${p}`),
        '[agent] Add them to .env (see .env.example) and restart `pnpm dev`.',
      ].join('\n'),
    );
    process.exit(0);
  }

  // Calls check their own settings (so a gap ends that call with a reason the rep can
  // read), but saying so now puts it in the log the moment a deploy starts.
  const call = readCallConfig(process.env);
  if (call.ok) console.log('[agent] Call settings are complete.');
  else console.warn(`[agent] ${describeMissingCallConfig(call.problems)}`);

  if (turnDetectorKind(process.env) === 'multilingual') {
    // The plan's text-based turn detector registers an inference runner when its
    // plugin is imported, and that must happen here, in the main process. The
    // runner needs its model on disk (`pnpm --filter @ccc/agent download-files`),
    // so the plugin is only imported when this detector is selected.
    await import('@livekit/agents-plugin-livekit');
  }

  cli.runApp(
    new ServerOptions({
      agent: fileURLToPath(import.meta.url),
      agentName: PROSPECT_AGENT_NAME,
    }),
  );
}
