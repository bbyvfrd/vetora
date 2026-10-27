import { sql } from 'drizzle-orm'
import { customType } from 'drizzle-orm/pg-core'

/**
 * The domains every practice table shares (spec 0002, "Conventions": Money, Languages). drizzle-kit does not model
 * domains, so each is a customType naming the SQL domain, and the domain itself, with its check, is hand written at
 * the top of the practice set's first migration: one copy per practice schema, versioned with the set. Every export
 * is tagged `@public`: a module's schema.ts types its money and language columns with these, and Biome's
 * noPrivateImports lets a module import nothing from src/platform/ without the tag (biome.jsonc, package visibility
 * inside src/modules/).
 */

/**
 * A fixed value set as a quoted, comma separated SQL list, for the check a text column's value set takes (spec 0002,
 * "Conventions": Value sets): `check('patient_sex_check', sql\`${table.sex} in (${sqlList(SEXES)})\`)`.
 * @public
 */
export const sqlList = (values: readonly string[]) => sql.raw(values.map((value) => `'${value}'`).join(', '))

/**
 * The currencies the money domain accepts; AZN only for now (spec 0002, "Money").
 * @public
 */
export const CURRENCY_CODES = ['AZN'] as const
/** @public */
export type CurrencyCode = (typeof CURRENCY_CODES)[number]

/**
 * The three languages the product ships in (spec 0002, "Languages"; AC-13).
 * @public
 */
export const LANG_CODES = ['az', 'ru', 'en'] as const
/** @public */
export type LangCode = (typeof LANG_CODES)[number]

/**
 * IN-4: money is integer minor units (bigint) beside a currency column; pg carries a bigint as text.
 * @public
 */
export const minorUnits = customType<{ data: bigint; driverData: string }>({
  dataType: () => 'minor_units',
  fromDriver: (value) => BigInt(value),
  toDriver: (value) => value.toString(),
})

/** @public */
export const currencyCode = customType<{ data: CurrencyCode; driverData: string }>({
  dataType: () => 'currency_code',
})

/** @public */
export const langCode = customType<{ data: LangCode; driverData: string }>({
  dataType: () => 'lang_code',
})
