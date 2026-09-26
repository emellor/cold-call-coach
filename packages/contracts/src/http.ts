import { z } from 'zod';
import { CallMode, ScenarioId } from './call.ts';
import { Difficulty, ProductSpec, ScenarioSpec } from './scenario.ts';

/** Every non-2xx JSON response from the API. */
export const ApiError = z.object({
  error: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiError>;

/** `GET /api/health` */
export const HealthResponse = z.object({
  ok: z.boolean(),
  db: z.object({
    ok: z.boolean(),
    latencyMs: z.number().nonnegative().optional(),
    error: z.string().optional(),
  }),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** `POST /api/calls` */
export const CreateCallRequest = z.object({
  scenarioId: ScenarioId,
  mode: CallMode,
});
export type CreateCallRequest = z.infer<typeof CreateCallRequest>;

export const CreateCallResponse = z.object({
  callId: z.uuid(),
  /** The LiveKit server URL to connect to. */
  url: z.string().regex(/^wss?:\/\//),
  /** A LiveKit access token for the rep, scoped to this call's room. */
  token: z.string().min(1),
});
export type CreateCallResponse = z.infer<typeof CreateCallResponse>;

/** One entry in the scenario picker. The hidden facts and thresholds stay server-side. */
export const ScenarioSummary = z.object({
  id: ScenarioId,
  version: z.int().positive(),
  title: z.string(),
  difficulty: Difficulty,
  winCondition: z.string(),
  prospect: z.object({ name: z.string(), role: z.string(), company: z.string() }),
});
export type ScenarioSummary = z.infer<typeof ScenarioSummary>;

/** `GET /api/scenarios` */
export const ScenarioListResponse = z.object({ scenarios: z.array(ScenarioSummary) });
export type ScenarioListResponse = z.infer<typeof ScenarioListResponse>;

/** `GET /internal/scenarios/:id` (agent only): everything the prospect and judge need. */
export const InternalScenarioResponse = z.object({
  scenario: ScenarioSpec,
  product: ProductSpec,
});
export type InternalScenarioResponse = z.infer<typeof InternalScenarioResponse>;

/** The header the agent authenticates /internal routes with. */
export const INTERNAL_SECRET_HEADER = 'x-internal-secret';
