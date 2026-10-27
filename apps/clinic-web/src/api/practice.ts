import { LOCATION_HEADER, type Me } from '@vetora/contracts'

/**
 * What every practice request carries (spec 0001, "Tenancy": Request context; #21), from `/api/me`: the practice in
 * the path and the location in the header, the default one until a person can choose another. Apart from session.ts,
 * so the contracts' schemas load with the pages that call practice routes, not with the shell.
 */
export function practiceParams(me: Me) {
  const location = me.locations.find((item) => item.isDefault) ?? me.locations[0]
  return {
    path: { practiceId: me.practice.id },
    header: { [LOCATION_HEADER]: location?.id ?? '' },
  }
}
