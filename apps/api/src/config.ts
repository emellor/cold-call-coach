import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { liveKitPairProblem } from '@ccc/core';
import { z } from 'zod';
import { repoRoot } from './paths.ts';

/** The docker-compose database; used when DATABASE_URL is unset outside production. */
export const DEV_DATABASE_URL = 'postgres://coach:coach@localhost:5432/coach';

/** `.env.example`'s value, so a fresh checkout works locally. Refused in production. */
export const DEV_INTERNAL_API_SECRET = 'dev-only-internal-secret';

/**
 * A value pasted into a host's settings loses any space or newline around it,
 * and an empty `KEY=` line means unset, not "the empty string".
 */
const cleaned = (v: unknown) => {
  const value = typeof v === 'string' ? v.trim() : v;
  return value === '' ? undefined : value;
};
const optional = <S extends z.ZodType>(schema: S) => z.preprocess(cleaned, schema.optional());

const Config = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.preprocess(
    cleaned,
    z
      .string({ error: 'is required' })
      .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection URL'),
  ),
  // Optional at boot so the API and health check run without them; the call
  // routes answer 503 naming what is missing.
  LIVEKIT_URL: optional(z.string().regex(/^wss?:\/\//, 'must be a ws:// or wss:// URL')),
  LIVEKIT_API_KEY: optional(z.string()),
  LIVEKIT_API_SECRET: optional(z.string()),
  // Shared with the agent for the /internal routes; they answer 503 without it.
  INTERNAL_API_SECRET: optional(z.string().min(16, 'must be at least 16 characters')),
  // The post-call review. Without a key, reviews fail with a reason the web shows.
  ANTHROPIC_API_KEY: optional(z.string().min(1)),
  REVIEW_MODEL: z.preprocess(cleaned, z.string().min(1).default('claude-opus-5')),
  REVIEW_EFFORT: z.preprocess(
    cleaned,
    z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('high'),
  ),
  // One password for a deployed app: every /api route then needs its session
  // cookie. Unset locally (no sign-in); required in production.
  APP_PASSWORD: optional(z.string().min(8, 'must be at least 8 characters')),
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
  if (parsed.success && parsed.data.NODE_ENV === 'production') {
    const problems = [
      parsed.data.INTERNAL_API_SECRET === DEV_INTERNAL_API_SECRET
        ? '  - INTERNAL_API_SECRET: is the development value; generate one with `openssl rand -hex 32`.'
        : '',
      parsed.data.APP_PASSWORD
        ? ''
        : '  - APP_PASSWORD: is required in production, where anyone could otherwise reach the app and spend your keys.',
      parsed.data.APP_PASSWORD && !parsed.data.INTERNAL_API_SECRET
        ? '  - INTERNAL_API_SECRET: is required with APP_PASSWORD; sessions are signed with it.'
        : '',
    ].filter(Boolean);
    if (problems.length) {
      throw new ConfigError(['Invalid API configuration:', ...problems].join('\n'));
    }
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

/**
 * The LiveKit settings, or what stops calls: the settings that are missing, or a
 * key pair that plainly can't be one. `problem` reads after "Calls are off: ".
 */
export function liveKitConfig(config: Config): LiveKitConfig | { problem: string } {
  const { LIVEKIT_URL: url, LIVEKIT_API_KEY: apiKey, LIVEKIT_API_SECRET: apiSecret } = config;
  if (url && apiKey && apiSecret) {
    const problem = liveKitPairProblem(apiKey, apiSecret);
    return problem ? { problem } : { url, apiKey, apiSecret };
  }
  const settings = { LIVEKIT_URL: url, LIVEKIT_API_KEY: apiKey, LIVEKIT_API_SECRET: apiSecret };
  const missing = Object.keys(settings).filter((name) => !settings[name as keyof typeof settings]);
  return { problem: `set ${missing.join(', ')} on the API.` };
}
