import { customType } from 'drizzle-orm/pg-core'

/**
 * The domains every practice table shares (spec 0002, "Conventions": Money, Languages). drizzle-kit does not model
 * domains, so each is a customType naming the SQL domain, and the domain itself, with its check, is hand written at
 * the top of the practice set's first migration: one copy per practice schema, versioned with the set.
 */

/** The currencies the money domain accepts; AZN only for now (spec 0002, "Money"). */
export const CURRENCY_CODES = ['AZN'] as const
export type CurrencyCode = (typeof CURRENCY_CODES)[number]

/** The three languages the product ships in (spec 0002, "Languages"; AC-13). */
export const LANG_CODES = ['az', 'ru', 'en'] as const
export type LangCode = (typeof LANG_CODES)[number]

/** IN-4: money is integer minor units (bigint) beside a currency column; pg carries a bigint as text. */
export const minorUnits = customType<{ data: bigint; driverData: string }>({
  dataType: () => 'minor_units',
  fromDriver: (value) => BigInt(value),
  toDriver: (value) => value.toString(),
})

export const currencyCode = customType<{ data: CurrencyCode; driverData: string }>({
  dataType: () => 'currency_code',
})

export const langCode = customType<{ data: LangCode; driverData: string }>({
  dataType: () => 'lang_code',
})
