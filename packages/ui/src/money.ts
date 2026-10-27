import { formatMoney, formatNumber } from './format.js'

/** The currencies the design system has a money format for, each with the number of digits in its minor unit. */
const MINOR_DIGITS: ReadonlyMap<string, number> = new Map([['AZN', 2]])

/** The digits of a currency's minor unit; throws for a currency the design system has no format for. */
function minorDigits(currency: string): number {
  const digits = MINOR_DIGITS.get(currency)
  if (digits === undefined) throw new RangeError(`the design system has no money format for ${currency}`)
  return digits
}

/**
 * An amount kept as whole minor units beside its currency, as the float in major units the design system's formatters
 * take, with the minor unit's digits. The one place minor units are divided. Throws, rather than show a wrong figure,
 * for a currency the design system has no format for, for what is not a number or a bigint, and for an amount that is
 * not a whole number of minor units or is too large for the formatter's float to keep its minor digits exactly.
 */
function majorUnits(amount: number | bigint, currency: string): { value: number; digits: number } {
  const digits = minorDigits(currency)
  if (typeof amount !== 'number' && typeof amount !== 'bigint') {
    throw new RangeError(`${String(amount)} is not an amount in minor units (IN-4)`)
  }
  const value = Number(amount)
  const unit = 10 ** digits
  // The formatters take a float. A double keeps `digits` decimals exact only while the whole part stays below
  // 2^(⌊52 − digits·log₂10⌋ + 1), which is 2^46 for two digits, about 70 trillion manat; above that the minor digits
  // can round wrong, so such an amount is refused rather than shown.
  const exactUpTo = 2 ** (Math.floor(52 - digits * Math.log2(10)) + 1) * unit
  if (!Number.isSafeInteger(value) || Math.abs(value) > exactUpTo) {
    throw new RangeError(`${String(amount)} is not a whole number of minor units that can be shown exactly (IN-4)`)
  }
  return { value: value / unit, digits }
}

/**
 * Writes an amount kept as whole minor units beside its currency code (domain.md IN-4, spec 0002 AC-9) in the design
 * system's money format: 125000 qəpik is "1 250,00 ₼" in Azerbaijani and Russian and "AZN 1,250.00" in English (the
 * artifact's formats.md, Money). With formatMinorUnitsPlain() below, the one place minor units become a displayed
 * amount; nothing else divides money. A bigint, which is how a 64-bit column leaves the database, is taken as is. The
 * locale defaults to the page's `lang`, as the design system's formatters do. Throws, rather than show a wrong figure,
 * for a currency the design system has no format for, for what is not a number or a bigint, and for an amount that is
 * not a whole number of minor units or is too large for the formatter's float to keep its minor digits exactly.
 */
export function formatMinorUnits(amount: number | bigint, currency: string, locale?: string): string {
  return formatMoney(majorUnits(amount, currency).value, locale)
}

/**
 * The same amount as a bare number with the minor unit's decimals and no currency: "1 250,00", "1,250.00". For a table
 * cell whose column heading carries the currency ("Qiymət, ₼"; formats.md, Money). Refuses what formatMinorUnits()
 * refuses.
 */
export function formatMinorUnitsPlain(amount: number | bigint, currency: string, locale?: string): string {
  const { value, digits } = majorUnits(amount, currency)
  return formatNumber(value, { decimals: digits, locale })
}

/**
 * Reads an amount typed in major units, as parseNumber() reads a number: a comma or a point as the decimal mark (both
 * present, the later one is it and the other groups thousands), spaces between thousands, the true minus sign or a
 * hyphen; at most the minor unit's digits after the mark. Answers the whole minor units, or null for what is not such
 * an amount: "43,50" is 4350 qəpik. The way back from formatMinorUnitsPlain() and the one place a typed amount becomes
 * minor units (IN-4): the digits are moved past the mark, never multiplied as a float, so no amount comes out a minor
 * unit off. Throws for a currency the design system has no format for.
 */
export function parseMinorUnits(text: string, currency: string): number | null {
  const digits = minorDigits(currency)
  // \s takes the no-break spaces the formatters write between thousands.
  let s = text.replace(/\s/g, '').replace('−', '-')
  const comma = s.lastIndexOf(',')
  const point = s.lastIndexOf('.')
  if (comma >= 0 && point >= 0) s = s.split(comma > point ? '.' : ',').join('')
  const [, sign, whole, fraction = ''] = /^(-?)(\d+)(?:[.,](\d+))?$/.exec(s) ?? []
  if (whole === undefined || fraction.length > digits) return null
  const minor = Number(whole + fraction.padEnd(digits, '0'))
  if (!Number.isSafeInteger(minor)) return null
  return sign && minor !== 0 ? -minor : minor
}
