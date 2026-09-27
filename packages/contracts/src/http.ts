import { z } from 'zod';
import { CallMode, CallOutcome, CallPhase, ScenarioId } from './call.ts';
import { CallTurn } from './callLog.ts';
import { CostBreakdown } from './cost.ts';
import { CallMetrics } from './metrics.ts';
import { ReviewResult, ReviewStatus } from './review.ts';
import { Difficulty, ProductSpec, ScenarioSpec } from './scenario.ts';

/** Every non-2xx JSON response from the API. */
export const ApiError = z.object({
  error: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiError>;

const Capability = z.object({
  ok: z.boolean(),
  /** Why not, in words for the page: which settings to add. */
  reason: z.string().optional(),
});

/** `GET /api/health` */
export const HealthResponse = z.object({
  ok: z.boolean(),
  db: z.object({
    ok: z.boolean(),
    latencyMs: z.number().nonnegative().optional(),
    error: z.string().optional(),
  }),
  /**
   * What the API's own settings allow. The agent's keys (Deepgram, Cartesia,
   * Claude for her replies) show up when a call starts.
   */
  features: z.object({ calls: Capability, reviews: Capability }).optional(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** `GET /api/auth/session`: whether this deploy needs the password, and whether we have signed in. */
export const SessionResponse = z.object({ required: z.boolean(), signedIn: z.boolean() });
export type SessionResponse = z.infer<typeof SessionResponse>;

/** `POST /api/auth/login`: the password (APP_PASSWORD) for a session cookie. */
export const LoginRequest = z.object({ password: z.string().min(1).max(1024) });
export type LoginRequest = z.infer<typeof LoginRequest>;

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
  /** Added with "Add new" rather than shipped in scenarios/; only these can be removed. */
  custom: z.boolean(),
});
export type ScenarioSummary = z.infer<typeof ScenarioSummary>;

/** `GET /api/scenarios` */
export const ScenarioListResponse = z.object({ scenarios: z.array(ScenarioSummary) });
export type ScenarioListResponse = z.infer<typeof ScenarioListResponse>;

/** `POST /api/scenarios`: "Add new", a prospect described in the rep's own words. */
export const CreateScenarioRequest = z.object({
  description: z
    .string()
    .trim()
    .min(10, 'Describe her in a sentence or two.')
    .max(2000, 'Keep the description under 2,000 characters.'),
});
export type CreateScenarioRequest = z.infer<typeof CreateScenarioRequest>;

export const CreateScenarioResponse = z.object({
  scenario: ScenarioSummary,
  /** `chosen`: a voice picked to fit her. `default`: CARTESIA_VOICE_ID, as the API can't list voices. */
  voice: z.enum(['chosen', 'default']),
});
export type CreateScenarioResponse = z.infer<typeof CreateScenarioResponse>;

/** `GET /internal/scenarios/:id` (agent only): everything the prospect and judge need. */
export const InternalScenarioResponse = z.object({
  scenario: ScenarioSpec,
  product: ProductSpec,
});
export type InternalScenarioResponse = z.infer<typeof InternalScenarioResponse>;

/** The header the agent authenticates /internal routes with. */
export const INTERNAL_SECRET_HEADER = 'x-internal-secret';

/** `POST /internal/calls/:id/log` (agent only). */
export const CallLogResponse = z.object({ ok: z.literal(true), review: ReviewStatus });
export type CallLogResponse = z.infer<typeof CallLogResponse>;

/** One row of the call history. */
export const CallSummary = z.object({
  id: z.uuid(),
  startedAt: z.iso.datetime(),
  mode: CallMode,
  status: CallPhase,
  outcome: CallOutcome.nullable(),
  durationMs: z.int().nonnegative().nullable(),
  scenario: z.object({
    id: ScenarioId,
    version: z.int().positive(),
    title: z.string(),
    difficulty: Difficulty,
    prospectName: z.string(),
  }),
  overallScore: z.int().min(0).max(100).nullable(),
  reviewStatus: ReviewStatus.nullable(),
  /** Everything priced so far (the call's providers and its review); null before the log. */
  costUsd: z.number().nonnegative().nullable(),
  /** Over the price table's warning line. */
  overBudget: z.boolean(),
});
export type CallSummary = z.infer<typeof CallSummary>;

/** `GET /api/calls` */
export const CallListResponse = z.object({ calls: z.array(CallSummary) });
export type CallListResponse = z.infer<typeof CallListResponse>;

export const CallReview = z.object({
  status: ReviewStatus,
  result: ReviewResult.nullable(),
  error: z.string().nullable(),
  model: z.string().nullable(),
  costUsd: z.number().nonnegative().nullable(),
  updatedAt: z.iso.datetime(),
});
export type CallReview = z.infer<typeof CallReview>;

/** `GET /api/calls/:id`: the call, its transcript, its metrics and its review. */
export const CallDetail = z.object({
  call: CallSummary,
  outcomeReason: z.string().nullable(),
  turns: z.array(CallTurn),
  /** Null until the call log has arrived. */
  metrics: CallMetrics.nullable(),
  review: CallReview.nullable(),
  /** Null until the call log has arrived. */
  cost: CostBreakdown.nullable(),
});
export type CallDetail = z.infer<typeof CallDetail>;

/** `POST /api/calls/:id/review/rerun` */
export const ReviewRerunResponse = z.object({ status: ReviewStatus });
export type ReviewRerunResponse = z.infer<typeof ReviewRerunResponse>;
