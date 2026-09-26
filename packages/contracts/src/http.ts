import { z } from 'zod';

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
