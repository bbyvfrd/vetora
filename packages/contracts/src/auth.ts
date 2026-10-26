import { z } from 'zod'
import { Language } from './me.js'

/**
 * POST /api/auth/sign-in/username request: one of the three Better Auth routes the API lets through (spec #18,
 * "Allowlist"). Only these two fields reach Better Auth, so no client can ask for a longer session.
 */
export const SignInRequest = z.object({
  /** `handle@practice-code`, which the sign in page joins from its Username and Clinic code fields. */
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
})
export type SignInRequest = z.infer<typeof SignInRequest>

/** GET /api/auth/get-session response: the signed in session and its login, or null without one. */
export const SessionResponse = z
  .object({
    session: z.object({
      id: z.uuid(),
      userId: z.uuid(),
      /** When the session ends, 12 hours after sign in, UTC, ISO 8601. */
      expiresAt: z.iso.datetime(),
    }),
    user: z.object({
      id: z.uuid(),
      name: z.string(),
      /** `handle@practice-code`. */
      username: z.string(),
      language: Language,
    }),
  })
  .nullable()
export type SessionResponse = z.infer<typeof SessionResponse>
