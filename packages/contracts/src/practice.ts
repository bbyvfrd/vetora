import { z } from 'zod'

/**
 * What every practice route shares (spec 0001, "Tenancy and data topology": Request context; spec #18): the practice in
 * the path, `/api/p/{practiceId}/…`, and the location the request acts at in a header, which the API checks against
 * the practice's active locations before any handler runs. The web app takes both from `GET /api/me`.
 */

/** The header naming the location a practice request acts at: one of the practice's active locations. */
export const LOCATION_HEADER = 'vetora-location'

/** The path parameter of every practice route. */
export const PracticePath = z.object({
  /** The practice's id, from `GET /api/me`. */
  practiceId: z.uuid(),
})
export type PracticePath = z.infer<typeof PracticePath>

/** A version as the entity tag `If-Match` carries: the number in quotes, `"3"` (a visit's #22, an invoice's #25). */
export const VersionTag = z.string().regex(/^"[1-9]\d*"$/, 'The version in quotes, such as "3"')

/** The `If-Match` value for a version. */
export const versionTag = (version: number): string => `"${version}"`

/** The version an `If-Match` value carries (validated by VersionTag). */
export const versionOfTag = (tag: string): number => Number(tag.slice(1, -1))

/** The headers every practice route requires. */
export const PracticeHeaders = z.object({
  /** One of the practice's active locations, from `GET /api/me`; the default one unless the person chose another. */
  [LOCATION_HEADER]: z.uuid(),
})
export type PracticeHeaders = z.infer<typeof PracticeHeaders>
