import { TZDate, tz } from '@date-fns/tz'
import { format } from 'date-fns'

/**
 * The time zone boundary (docs/design.md, "Formatters": Time; docs/domain.md §10): the API sends instants in UTC and the
 * design system's formatters read a `Date` through its local getters, so an instant is turned into the practice's wall
 * clock here, never with `new Date(instant)` straight from the API. The zone is the practice's, from `/api/me`.
 */

/** A UTC instant as the practice's wall clock, for `formatTime` and `formatDate`. */
export const wallClock = (instant: string, timeZone: string): Date => new TZDate(instant, timeZone)

/** The practice's today, `YYYY-MM-DD`, for `formatAge` and `formatDate`'s `relativeTo`. */
export const practiceToday = (timeZone: string): string => format(new Date(), 'yyyy-MM-dd', { in: tz(timeZone) })
