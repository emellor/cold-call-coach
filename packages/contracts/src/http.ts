import { z } from 'zod';
import { CallMode, ScenarioId } from './call.ts';

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
