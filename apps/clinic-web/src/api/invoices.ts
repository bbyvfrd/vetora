import { queryOptions } from '@tanstack/react-query'
import type { Invoice, Me, Services } from '@vetora/contracts'
import { api } from './client'
import { practiceParams } from './practice'

/**
 * What the visit page's invoice card reads (#25): the price list its search offers, and the visit's invoice, null
 * before its first line. Every change to the invoice answers the invoice as it then stands, which the card puts in
 * place of this query's data.
 */

export const servicesQuery = (me: Me) =>
  queryOptions({
    queryKey: ['services', me.practice.id] as const,
    queryFn: async (): Promise<Services['services']> => {
      const { data, response } = await api.GET('/api/p/{practiceId}/services', { params: practiceParams(me) })
      if (!data) throw new Error(`services answered ${response.status}`)
      return data.services
    },
    // The price list changes when an operator loads it; a visit's few minutes need not ask again.
    staleTime: 5 * 60_000,
  })

export const visitInvoiceQuery = (me: Me, visitId: string) =>
  queryOptions({
    queryKey: ['visit-invoice', me.practice.id, visitId] as const,
    queryFn: async (): Promise<Invoice | null> => {
      const { data, response } = await api.GET('/api/p/{practiceId}/visits/{visitId}/invoice', {
        params: { ...practiceParams(me), path: { practiceId: me.practice.id, visitId } },
      })
      if (!data) throw new Error(`visit invoice answered ${response.status}`)
      return data.invoice
    },
  })
