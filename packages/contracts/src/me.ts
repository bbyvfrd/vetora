import { z } from 'zod'
import { StaffRole } from './staff.js'

/** The three interface languages (spec 0001, "Translations"). */
export const Language = z.enum(['az', 'ru', 'en'])
export type Language = z.infer<typeof Language>

/**
 * GET /api/me response: who is signed in, their practice with their roles, and its locations (spec #18, story 27).
 * The web app builds every practice path and the location header from it, never from Better Auth's active
 * organization.
 */
export const Me = z.object({
  /** The login's id, which is also the person's staff_member id in their practice. */
  id: z.uuid(),
  displayName: z.string(),
  /** The interface language saved to the login, which follows the person to any computer. */
  language: Language,
  practice: z.object({
    id: z.uuid(),
    /** The practice's display name, from its settings. */
    name: z.string(),
    /** The practice code staff sign in with (Clinic code on screen). */
    code: z.string(),
    /** The person's roles in it, from their membership. */
    roles: z.array(StaffRole).min(1),
  }),
  /** The practice's active locations, the default one first and marked. */
  locations: z.array(z.object({ id: z.uuid(), name: z.string(), isDefault: z.boolean() })),
})
export type Me = z.infer<typeof Me>

/** PUT /api/me/language request: the language to save to the login. */
export const LanguageUpdate = z.object({ language: Language })
export type LanguageUpdate = z.infer<typeof LanguageUpdate>
