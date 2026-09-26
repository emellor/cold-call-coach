import { z } from 'zod';

/** Coached calls show the live panel and tips; exam calls are review-only. */
export const CallMode = z.enum(['coached', 'exam']);
export type CallMode = z.infer<typeof CallMode>;

export const CallPhase = z.enum(['ringing', 'connected', 'ended']);
export type CallPhase = z.infer<typeof CallPhase>;

export const CallOutcome = z.enum([
  'meeting_booked',
  'hung_up_by_prospect',
  'ended_by_rep',
  'timeout',
  'error',
]);
export type CallOutcome = z.infer<typeof CallOutcome>;

export const ScenarioId = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be kebab-case');

/** The JSON the API puts on the LiveKit agent dispatch and the agent reads back. */
export const DispatchMetadata = z.object({
  callId: z.uuid(),
  scenarioId: ScenarioId,
  mode: CallMode,
});
export type DispatchMetadata = z.infer<typeof DispatchMetadata>;

/** The rep's participant identity in every call room. */
export const REP_IDENTITY = 'rep';

/** The LiveKit agent name the API dispatches to. */
export const PROSPECT_AGENT_NAME = 'prospect';

/** Hard ceiling on a call, enforced by the agent; the rep's token lives as long. */
export const MAX_CALL_SECONDS = 15 * 60;

export const roomNameForCall = (callId: string): string => `call-${callId}`;
