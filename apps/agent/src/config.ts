import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const repoEnvFile = fileURLToPath(new URL('../../../.env', import.meta.url));

const AgentConfig = z.object({
  LIVEKIT_URL: z.string().regex(/^wss?:\/\//, 'must be a ws:// or wss:// URL'),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
});
export type AgentConfig = z.infer<typeof AgentConfig>;

export type ConfigResult = { ok: true; config: AgentConfig } | { ok: false; problems: string[] };

/**
 * Loads the repo-root `.env` into `process.env`. Variables already set in the
 * environment win.
 */
export function loadDotEnv(path = repoEnvFile): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

export function readConfig(env: NodeJS.ProcessEnv): ConfigResult {
  const parsed = AgentConfig.safeParse(env);
  if (parsed.success) return { ok: true, config: parsed.data };
  return {
    ok: false,
    problems: parsed.error.issues.map((i) =>
      i.code === 'invalid_type' && i.input === undefined
        ? `${i.path.join('.')} is not set`
        : `${i.path.join('.')} ${i.message}`,
    ),
  };
}
