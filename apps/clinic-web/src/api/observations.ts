import { queryOptions } from '@tanstack/react-query'
import type { Me, Observation } from '@vetora/contracts'
import { api } from './client'
import { practiceParams } from './practice'

/**
 * The vital signs the visit page reads (#23): the visit's readings, which fill its fields, and the patient's last
 * weight from before the visit, which the weight field shows under it. A reading recorded on the page marks the
 * visit's readings stale; the last weight leaves the visit's own out, so it stays as it was.
 */

export const observationsQuery = (me: Me, visitId: string) =>
  queryOptions({
    queryKey: ['observations', me.practice.id, visitId] as const,
    queryFn: async (): Promise<Observation[]> => {
      const { data, response } = await api.GET('/api/p/{practiceId}/visits/{visitId}/observations', {
        params: { ...practiceParams(me), path: { practiceId: me.practice.id, visitId } },
      })
      if (!data) throw new Error(`observations answered ${response.status}`)
      return data.observations
    },
  })

/** The patient's newest weight that is not one of `visitId`'s readings: what the weight field shows under it. */
export const lastWeightQuery = (me: Me, patientId: string, visitId: string) =>
  queryOptions({
    queryKey: ['last-weight', me.practice.id, patientId, visitId] as const,
    queryFn: async (): Promise<Observation | null> => {
      const { data, response } = await api.GET('/api/p/{practiceId}/patients/{patientId}/last-weight', {
        params: {
          ...practiceParams(me),
          path: { practiceId: me.practice.id, patientId },
          query: { excludingVisit: visitId },
        },
      })
      if (!data) throw new Error(`last weight answered ${response.status}`)
      return data.lastWeight
    },
  })
