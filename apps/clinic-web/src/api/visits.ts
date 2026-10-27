import { queryOptions } from '@tanstack/react-query'
import type { Me, Visit, VisitsToday } from '@vetora/contracts'
import { api } from './client'
import { practiceParams } from './practice'

/**
 * A visit with what its patient header shows (#22), the owner's Balance due included (#26): the visit page reads it,
 * and an issued invoice or a payment marks it stale so the balance is current.
 */
export const visitQuery = (me: Me, visitId: string) =>
  queryOptions({
    queryKey: ['visit', me.practice.id, visitId] as const,
    queryFn: async (): Promise<Visit> => {
      const { data, response } = await api.GET('/api/p/{practiceId}/visits/{visitId}', {
        params: { ...practiceParams(me), path: { practiceId: me.practice.id, visitId } },
      })
      if (!data) throw new Error(`visit answered ${response.status}`)
      return data
    },
  })

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
