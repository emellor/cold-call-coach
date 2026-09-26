import { fileURLToPath, pathToFileURL } from 'node:url';
import { type JobContext, ServerOptions, cli, defineAgent, log } from '@livekit/agents';
import { loadDotEnv, readConfig } from './config.ts';

/** The name the API dispatches to (PLAN.md §5). Explicit dispatch only. */
export const AGENT_NAME = 'prospect';

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const logger = log().child({ room: ctx.job.room?.name });
    logger.info({ jobId: ctx.job.id, metadata: ctx.job.metadata }, 'job received');
    await ctx.connect();
    logger.info('connected; M0 has no voice session yet, leaving the room');
    ctx.shutdown('m0-skeleton');
  },
});

// This file is also loaded inside each job's child process, where the CLI must
// not run again; only the process started as `node src/main.ts …` runs it.
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  loadDotEnv();
  const result = readConfig(process.env);
  if (!result.ok) {
    // Exit 0 so `pnpm dev` keeps the API and web running without LiveKit.
    console.warn(
      [
        '[agent] LiveKit is not configured, so the prospect agent will not start:',
        ...result.problems.map((p) => `[agent]   - ${p}`),
        '[agent] Add them to .env (see .env.example) and restart `pnpm dev`.',
      ].join('\n'),
    );
    process.exit(0);
  }

  cli.runApp(
    new ServerOptions({
      agent: fileURLToPath(import.meta.url),
      agentName: AGENT_NAME,
    }),
  );
}
