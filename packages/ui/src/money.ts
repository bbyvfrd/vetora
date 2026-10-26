import { formatMoney } from './format.js'

/** The currencies the design system has a money format for, each with the number of digits in its minor unit. */
const MINOR_DIGITS: ReadonlyMap<string, number> = new Map([['AZN', 2]])

/**
 * Writes an amount kept as whole minor units beside its currency code (domain.md IN-4, spec 0002 AC-9) in the design
 * system's money format: 125000 qəpik is "1 250,00 ₼" in Azerbaijani and Russian and "AZN 1,250.00" in English (the
 * artifact's formats.md, Money). The one place minor units become a displayed amount; nothing else divides money. A
 * bigint, which is how a 64-bit column leaves the database, is taken as is. The locale defaults to the page's `lang`,
 * as the design system's formatters do. Throws, rather than show a wrong figure, for a currency the design system has
 * no format for, for what is not a number or a bigint, and for an amount that is not a whole number of minor units or
 * is too large for the formatter's float to keep its minor digits exactly.
 */
export function formatMinorUnits(amount: number | bigint, currency: string, locale?: string): string {
  const digits = MINOR_DIGITS.get(currency)
  if (digits === undefined) throw new RangeError(`the design system has no money format for ${currency}`)
  if (typeof amount !== 'number' && typeof amount !== 'bigint') {
    throw new RangeError(`${String(amount)} is not an amount in minor units (IN-4)`)
  }
  const value = Number(amount)
  const unit = 10 ** digits
  // formatMoney takes a float. A double keeps `digits` decimals exact only while the whole part stays below
  // 2^(⌊52 − digits·log₂10⌋ + 1), which is 2^46 for two digits, about 70 trillion manat; above that the minor digits
  // can round wrong, so such an amount is refused rather than shown.
  const exactUpTo = 2 ** (Math.floor(52 - digits * Math.log2(10)) + 1) * unit
  if (!Number.isSafeInteger(value) || Math.abs(value) > exactUpTo) {
    throw new RangeError(`${String(amount)} is not a whole number of minor units that can be shown exactly (IN-4)`)
  }
  return formatMoney(value / unit, locale)
}
