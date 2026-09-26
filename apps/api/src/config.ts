import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { repoRoot } from './paths.ts';

/** The docker-compose database; used when DATABASE_URL is unset outside production. */
export const DEV_DATABASE_URL = 'postgres://coach:coach@localhost:5432/coach';

/** An empty `KEY=` line in .env means unset, not "the empty string". */
const optional = <S extends z.ZodType>(schema: S) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const Config = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z
    .string({ error: 'is required' })
    .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection URL'),
  // Optional at boot so the API and health check run without them; the call
  // routes answer 503 naming what is missing.
  LIVEKIT_URL: optional(z.string().regex(/^wss?:\/\//, 'must be a ws:// or wss:// URL')),
  LIVEKIT_API_KEY: optional(z.string()),
  LIVEKIT_API_SECRET: optional(z.string()),
});
export type Config = z.infer<typeof Config>;

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/**
 * Loads the repo-root `.env` into `process.env`. Variables already set in the
 * environment win, so a deploy's real environment is never overridden.
 */
export function loadDotEnv(path = join(repoRoot, '.env')): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const input = { ...env };
  if (!input.DATABASE_URL && input.NODE_ENV !== 'production') {
    input.DATABASE_URL = DEV_DATABASE_URL;
  }
  const parsed = Config.safeParse(input);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new ConfigError(
      ['Invalid API configuration:', ...lines, 'See .env.example for every variable.'].join('\n'),
    );
  }
  return parsed.data;
}

export interface LiveKitConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
}

/** The LiveKit settings, or the names of the ones that are missing. */
export function liveKitConfig(config: Config): LiveKitConfig | { missing: string[] } {
  const { LIVEKIT_URL: url, LIVEKIT_API_KEY: apiKey, LIVEKIT_API_SECRET: apiSecret } = config;
  if (url && apiKey && apiSecret) return { url, apiKey, apiSecret };
  const settings = { LIVEKIT_URL: url, LIVEKIT_API_KEY: apiKey, LIVEKIT_API_SECRET: apiSecret };
  return {
    missing: Object.keys(settings).filter((name) => !settings[name as keyof typeof settings]),
  };
}
