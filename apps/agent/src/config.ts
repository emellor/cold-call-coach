import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const repoEnvFile = fileURLToPath(new URL('../../../.env', import.meta.url));

/** An empty `KEY=` line in .env means unset. */
const blankIsUnset = (v: unknown) => (v === '' ? undefined : v);
/** Blank counts as unset, so a `.default()` inside still applies. */
const blankAsUnset = <S extends z.ZodType>(schema: S) => z.preprocess(blankIsUnset, schema);
const nonEmpty = () => blankAsUnset(z.string().min(1));

const Effort = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);

/** Needed for the worker to register with LiveKit at all. */
const WorkerConfig = z.object({
  LIVEKIT_URL: blankAsUnset(z.string().regex(/^wss?:\/\//, 'must be a ws:// or wss:// URL')),
  LIVEKIT_API_KEY: nonEmpty(),
  LIVEKIT_API_SECRET: nonEmpty(),
});
export type WorkerConfig = z.infer<typeof WorkerConfig>;

/**
 * Needed for a call. Checked per job rather than at boot, so a missing key ends
 * that call with a reason the rep can read instead of taking the worker down.
 */
const CallConfig = z.object({
  ANTHROPIC_API_KEY: nonEmpty(),
  DEEPGRAM_API_KEY: nonEmpty(),
  CARTESIA_API_KEY: nonEmpty(),
  /** The voice for a scenario whose `voice.voiceId` is still the placeholder. */
  CARTESIA_VOICE_ID: blankAsUnset(z.string().min(1).optional()),
  /** Where the agent loads the scenario from (GET /internal/scenarios/:id). */
  API_BASE_URL: blankAsUnset(
    z
      .string()
      .regex(/^https?:\/\//, 'must be an http:// or https:// URL')
      .default('http://localhost:3000')
      .transform((url) => url.replace(/\/+$/, '')),
  ),
  INTERNAL_API_SECRET: nonEmpty(),
  PROSPECT_MODEL: blankAsUnset(z.string().min(1).default('claude-opus-5')),
  PROSPECT_EFFORT: blankAsUnset(Effort.default('low')),
  /** The judge (and, from M5, the coach's hints). */
  COACH_MODEL: blankAsUnset(z.string().min(1).default('claude-opus-5')),
  COACH_EFFORT: blankAsUnset(Effort.default('low')),
  /**
   * `multilingual` is PLAN.md's text-based detector (@livekit/agents-plugin-livekit,
   * model fetched by `download-files`). `audio` is LiveKit's newer on-device audio
   * model, which the plugin now recommends; no download needed.
   */
  TURN_DETECTOR: blankAsUnset(z.enum(['multilingual', 'audio']).default('multilingual')),
  /** Where call logs wait when the API can't be reached (default: the OS temp dir). */
  AGENT_SPOOL_DIR: blankAsUnset(z.string().min(1).optional()),
});
export type CallConfig = z.infer<typeof CallConfig>;

export type ConfigResult<T> = { ok: true; config: T } | { ok: false; problems: string[] };

/**
 * Loads the repo-root `.env` into `process.env`. Variables already set in the
 * environment win.
 */
export function loadDotEnv(path = repoEnvFile): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

function read<T>(schema: z.ZodType<T>, env: NodeJS.ProcessEnv): ConfigResult<T> {
  const parsed = schema.safeParse(env);
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

/**
 * On Render (render.yaml) the worker is handed the API's private `host:port`, and a
 * Blueprint can't build a URL from it, so this does when API_BASE_URL is unset.
 */
function withApiBaseUrl(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const hostport = env.API_HOSTPORT?.trim();
  if (env.API_BASE_URL || !hostport) return env;
  return { ...env, API_BASE_URL: `http://${hostport}` };
}

export const readWorkerConfig = (env: NodeJS.ProcessEnv) => read(WorkerConfig, env);

/** The selected turn detector; an invalid value falls back to the default here and fails the call later. */
export const turnDetectorKind = (env: NodeJS.ProcessEnv): CallConfig['TURN_DETECTOR'] =>
  CallConfig.shape.TURN_DETECTOR.safeParse(env.TURN_DETECTOR).data ?? 'multilingual';
export const readCallConfig = (env: NodeJS.ProcessEnv) => read(CallConfig, withApiBaseUrl(env));
