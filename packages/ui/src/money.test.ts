import { describe, expect, it } from 'vitest'
import { formatMinorUnits, formatMinorUnitsPlain, parseMinorUnits } from './money.js'

const NBSP = ' '

/**
 * The money wrapper (spec #9, "Money"; domain.md IN-4): an amount kept as integer minor units with its currency
 * becomes the design system's money format here and nowhere else. The expected strings are the artifact's formats.md,
 * its Money table.
 */
describe('formatMinorUnits(), minor units with a currency to the design system’s money format (IN-4)', () => {
  it('writes 125000 qəpik as 1 250,00 ₼ in Azerbaijani and Russian and as AZN 1,250.00 in English', () => {
    expect(formatMinorUnits(125000, 'AZN', 'az')).toBe(`1${NBSP}250,00${NBSP}₼`)
    expect(formatMinorUnits(125000, 'AZN', 'ru')).toBe(`1${NBSP}250,00${NBSP}₼`)
    expect(formatMinorUnits(125000, 'AZN', 'en')).toBe(`AZN${NBSP}1,250.00`)
  })

  it('keeps the design system’s true minus sign on a negative amount, in every language', () => {
    expect(formatMinorUnits(-400, 'AZN', 'az')).toBe(`−4,00${NBSP}₼`)
    expect(formatMinorUnits(-400, 'AZN', 'ru')).toBe(`−4,00${NBSP}₼`)
    expect(formatMinorUnits(-400, 'AZN', 'en')).toBe(`AZN${NBSP}−4.00`)
  })

  it('writes zero and an amount under one manat with two decimals', () => {
    expect(formatMinorUnits(0, 'AZN', 'az')).toBe(`0,00${NBSP}₼`)
    expect(formatMinorUnits(0, 'AZN', 'en')).toBe(`AZN${NBSP}0.00`)
    expect(formatMinorUnits(5, 'AZN', 'ru')).toBe(`0,05${NBSP}₼`)
  })

  it('takes a bigint, as a 64-bit amount leaves the database, the same as a number', () => {
    expect(formatMinorUnits(125000n, 'AZN', 'az')).toBe(`1${NBSP}250,00${NBSP}₼`)
    expect(formatMinorUnits(123456789n, 'AZN', 'en')).toBe(`AZN${NBSP}1,234,567.89`)
    expect(formatMinorUnits(-1n, 'AZN', 'ru')).toBe(`−0,01${NBSP}₼`)
  })

  it('follows the page’s language when none is given, English where there is no page', () => {
    expect(formatMinorUnits(100, 'AZN')).toBe(`AZN${NBSP}1.00`)
  })

  it('refuses what is not a whole number of minor units rather than showing it wrong (IN-4)', () => {
    expect(() => formatMinorUnits(12.5, 'AZN', 'az')).toThrow(RangeError)
    expect(() => formatMinorUnits(Number.NaN, 'AZN', 'az')).toThrow(RangeError)
    expect(() => formatMinorUnits(2n ** 53n, 'AZN', 'az')).toThrow(RangeError)
    expect(() => formatMinorUnits(null as unknown as number, 'AZN', 'az')).toThrow(RangeError)
  })

  it('refuses an amount above 2^46 manat, where a double cannot hold the qəpik and formatMoney would round them', () => {
    // 70 368 744 177 664,01 would show as ,02; 70 395 205 976 229,62 as ,63.
    expect(() => formatMinorUnits(7036874417766401n, 'AZN', 'az')).toThrow(RangeError)
    expect(() => formatMinorUnits(7039520597622962n, 'AZN', 'az')).toThrow(RangeError)
    expect(formatMinorUnits(7036874417766400n, 'AZN', 'az')).toBe(
      `70${NBSP}368${NBSP}744${NBSP}177${NBSP}664,00${NBSP}₼`,
    )
  })

  it('refuses a currency the design system has no format for, rather than inventing one', () => {
    expect(() => formatMinorUnits(100, 'USD', 'en')).toThrow(RangeError)
    expect(() => formatMinorUnits(100, 'toString', 'en')).toThrow(RangeError)
  })
})

describe('formatMinorUnitsPlain(), the bare number a table cell under "Qiymət, ₼" shows (IN-4)', () => {
  it('writes 125000 qəpik as 1 250,00 in Azerbaijani and Russian and as 1,250.00 in English, without the currency', () => {
    expect(formatMinorUnitsPlain(125000, 'AZN', 'az')).toBe(`1${NBSP}250,00`)
    expect(formatMinorUnitsPlain(125000n, 'AZN', 'ru')).toBe(`1${NBSP}250,00`)
    expect(formatMinorUnitsPlain(125000, 'AZN', 'en')).toBe('1,250.00')
    expect(formatMinorUnitsPlain(0, 'AZN', 'en')).toBe('0.00')
    expect(formatMinorUnitsPlain(-5, 'AZN', 'az')).toBe('−0,05')
  })

  it('refuses what formatMinorUnits refuses', () => {
    expect(() => formatMinorUnitsPlain(12.5, 'AZN', 'az')).toThrow(RangeError)
    expect(() => formatMinorUnitsPlain(100, 'USD', 'en')).toThrow(RangeError)
    expect(() => formatMinorUnitsPlain(2n ** 53n, 'AZN', 'en')).toThrow(RangeError)
  })
})

describe('parseMinorUnits(), an amount typed in manat to whole qəpik (IN-4, #26)', () => {
  it('reads a comma or a point as the decimal mark, up to two decimals, as the dialog prefills and people type', () => {
    expect(parseMinorUnits('43,50', 'AZN')).toBe(4350)
    expect(parseMinorUnits('43.5', 'AZN')).toBe(4350)
    expect(parseMinorUnits('43', 'AZN')).toBe(4300)
    expect(parseMinorUnits(' 0,05 ', 'AZN')).toBe(5)
    expect(parseMinorUnits('0', 'AZN')).toBe(0)
  })

  it('reads back what formatMinorUnitsPlain writes, in every language, thousands and their spaces included', () => {
    for (const locale of ['az', 'ru', 'en']) {
      for (const amount of [125000, 7, 123456789]) {
        expect(parseMinorUnits(formatMinorUnitsPlain(amount, 'AZN', locale), 'AZN'), `${locale} ${amount}`).toBe(amount)
      }
    }
    expect(parseMinorUnits('1 250,00', 'AZN')).toBe(125000)
  })

  it('moves the digits rather than multiplying a float, so no amount comes out a qəpik off', () => {
    // 0.29 * 100 is 28.999999999999996 and 1.005 * 100 is 100.49999999999999 in a double.
    expect(parseMinorUnits('0,29', 'AZN')).toBe(29)
    expect(parseMinorUnits('1.15', 'AZN')).toBe(115)
    expect(parseMinorUnits('70368744177664,01', 'AZN')).toBe(7036874417766401)
  })

  it('reads a minus, either sign, so that a negative amount is refused by the form for what it is', () => {
    expect(parseMinorUnits('-4,00', 'AZN')).toBe(-400)
    expect(parseMinorUnits('−0,05', 'AZN')).toBe(-5)
  })

  it('answers null for what is not an amount in manat: more than two decimals, letters, signs, nothing', () => {
    for (const text of ['43,505', '4,3,5', 'abc', '12₼', '+5', '1e3', '', ' ', ',', '5,', '99999999999999999']) {
      expect(parseMinorUnits(text, 'AZN'), text).toBeNull()
    }
  })

  it('refuses a currency the design system has no format for', () => {
    expect(() => parseMinorUnits('1', 'USD')).toThrow(RangeError)
  })
})
