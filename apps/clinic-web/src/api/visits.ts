import { queryOptions } from '@tanstack/react-query'
import type { Me, VisitsToday } from '@vetora/contracts'
import { api } from './client'
import { practiceParams } from './practice'

/** How often Visits today is asked again while it is open: polling until the schedule's live updates (slice 5). */
const POLL_MS = 30_000

/**
 * The day's visits at the person's location (#22): Visits today shows them, and a visit completed or cancelled marks
 * them stale so the list is current when the person returns to it.
 */
export const visitsTodayQuery = (me: Me) =>
  queryOptions({
    queryKey: ['visits-today', me.practice.id, practiceParams(me).header] as const,
    queryFn: async (): Promise<VisitsToday> => {
      const { data, response } = await api.GET('/api/p/{practiceId}/visits', { params: practiceParams(me) })
      if (!data) throw new Error(`visits answered ${response.status}`)
      return data
    },
    refetchInterval: POLL_MS,
  })
