import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { repoRoot } from './paths.ts';

/** The docker-compose database; used when DATABASE_URL is unset outside production. */
export const DEV_DATABASE_URL = 'postgres://coach:coach@localhost:5432/coach';

/** `.env.example`'s value, so a fresh checkout works locally. Refused in production. */
export const DEV_INTERNAL_API_SECRET = 'dev-only-internal-secret';

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
  // Shared with the agent for the /internal routes; they answer 503 without it.
  INTERNAL_API_SECRET: optional(z.string().min(16, 'must be at least 16 characters')),
  // The post-call review. Without a key, reviews fail with a reason the web shows.
  ANTHROPIC_API_KEY: optional(z.string().min(1)),
  REVIEW_MODEL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).default('claude-opus-5'),
  ),
  REVIEW_EFFORT: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('high'),
  ),
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
  if (
    parsed.success &&
    parsed.data.NODE_ENV === 'production' &&
    parsed.data.INTERNAL_API_SECRET === DEV_INTERNAL_API_SECRET
  ) {
    throw new ConfigError(
      'Invalid API configuration:\n  - INTERNAL_API_SECRET: is the development value; generate one with `openssl rand -hex 32`.',
    );
  }
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
