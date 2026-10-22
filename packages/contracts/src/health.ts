import { z } from 'zod'

/** GET /api/health response. */
export const HealthResponse = z.object({
  status: z.literal('ok'),
  /** The deployed image version (Kamal's), or `dev` locally. */
  version: z.string(),
  database: z.enum(['ok', 'unavailable']),
  /** Server time, UTC, ISO 8601. */
  time: z.iso.datetime(),
})
export type HealthResponse = z.infer<typeof HealthResponse>
