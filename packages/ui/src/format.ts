import { daysBetween, NAMES, toYmd, two, weekday } from './dates.js'

/** The three interface languages. */
export type Lang = 'az' | 'ru' | 'en'

const NBSP = ' '
const MINUS = '−'

/** The interface language: the given tag, else the page's `lang`, else English. */
export function langOf(locale?: string): Lang {
  const tag = (locale || (typeof document !== 'undefined' && document.documentElement.lang) || 'en')
    .slice(0, 2)
    .toLowerCase()
  return tag === 'az' || tag === 'ru' ? tag : 'en'
}

export interface NumberOptions {
  /** A fixed number of decimals: 2 for money. Left out, up to three are kept and trailing zeros dropped. */
  decimals?: number
  /** Language tag. Defaults to the page's `lang`. */
  locale?: string
}

/**
 * Writes a number the way the interface language does: "1 250,5" in Azerbaijani and Russian, "1,250.5" in English.
 * It does not use the browser's Intl, which has no Azerbaijani data in Chrome.
 */
export function formatNumber(value: number, options: NumberOptions = {}): string {
  if (!Number.isFinite(value)) return ''
  const lang = langOf(options.locale)
  const fixed =
    options.decimals !== undefined ? Math.abs(value).toFixed(options.decimals) : String(+Math.abs(value).toFixed(3))
  const [whole, fraction] = fixed.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'en' ? ',' : NBSP)
  const sign = value < 0 && +fixed !== 0 ? MINUS : ''
  return sign + grouped + (fraction ? (lang === 'en' ? '.' : ',') + fraction : '')
}

/** Writes an amount in manat: "1 250,00 ₼" in Azerbaijani and Russian, "AZN 1,250.00" in English. */
export function formatMoney(value: number, locale?: string): string {
  const number = formatNumber(value, { decimals: 2, locale })
  if (!number) return ''
  return langOf(locale) === 'en' ? `AZN${NBSP}${number}` : `${number + NBSP}₼`
}

/** Reads a typed number: a comma or a point as the decimal mark, spaces between thousands. Returns null when it is not a number. */
export function parseNumber(text: string): number | null {
  let s = text.replace(/[\s  ]/g, '').replace(MINUS, '-')
  if (!s) return null
  const comma = s.lastIndexOf(',')
  const point = s.lastIndexOf('.')
  if (comma >= 0 && point >= 0) {
    // both present: the later one is the decimal mark, the other groups thousands
    const group = comma > point ? '.' : ','
    s = s.split(group).join('')
  }
  s = s.replace(',', '.')
  return /^-?\d+(\.\d+)?$/.test(s) ? parseFloat(s) : null
}

export type DateStyle = 'short' | 'long' | 'full' | 'day' | 'weekday' | 'month'

export interface DateOptions {
  /**
   * short (default) "12.10.2026", in English "12 Oct 2026" · long "12 oktyabr 2026" · full adds the weekday ·
   * day "12 oktyabr" · weekday "12 oktyabr, bazar ertəsi" · month "Oktyabr 2026".
   */
  style?: DateStyle
  /** Language tag. Defaults to the page's `lang`. */
  locale?: string
  /** Today, as YYYY-MM-DD or a Date. When given, yesterday, today and tomorrow are written as the word: "Bu gün". */
  relativeTo?: string | Date
}

const RELATIVE: Record<Lang, [string, string, string]> = {
  az: ['Dünən', 'Bu gün', 'Sabah'],
  ru: ['Вчера', 'Сегодня', 'Завтра'],
  en: ['Yesterday', 'Today', 'Tomorrow'],
}
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/**
 * Writes a date the way the interface language does, from YYYY-MM-DD or a Date: "12.10.2026" in Azerbaijani and Russian,
 * "12 Oct 2026" in English, and five longer styles. The parts of a date are joined with non-breaking spaces.
 * Month and weekday names are the bundle's own, the same in every browser. Returns '' for something that is not a date.
 */
export function formatDate(value: string | Date, options: DateOptions = {}): string {
  const v = toYmd(value)
  if (!v) return ''
  const lang = langOf(options.locale)
  const names = NAMES[lang]
  const today = toYmd(options.relativeTo)
  if (today) {
    const gap = daysBetween(today, v)
    if (gap >= -1 && gap <= 1) return RELATIVE[lang][gap + 1]
  }
  const dayMonth = v.d + NBSP + names.months[v.m - 1]
  const day = names.days[weekday(v)]
  switch (options.style || 'short') {
    case 'long':
      return dayMonth + NBSP + v.y
    case 'full':
      return lang === 'az' ? `${dayMonth + NBSP + v.y}, ${day}` : `${capital(day)}, ${dayMonth}${NBSP}${v.y}`
    case 'day':
      return dayMonth
    case 'weekday':
      return lang === 'az' ? `${dayMonth}, ${day}` : `${capital(day)}, ${dayMonth}`
    case 'month':
      return names.monthsAlone[v.m - 1] + NBSP + v.y
    default:
      return lang === 'en'
        ? v.d + NBSP + (names.monthsShort as string[])[v.m - 1] + NBSP + v.y
        : `${two(v.d)}.${two(v.m)}.${v.y}`
  }
}

/** Writes a time on the 24-hour clock, from "HH:MM", "HH:MM:SS" or a Date: "09:05". The same in every language. */
export function formatTime(value: string | Date): string {
  if (typeof value !== 'string')
    return Number.isNaN(value.getTime()) ? '' : `${two(value.getHours())}:${two(value.getMinutes())}`
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim())
  return m && +m[1] < 24 && +m[2] < 60 ? `${two(+m[1])}:${m[2]}` : ''
}

export interface PluralForms {
  /** 1 (and in Russian 21, 31…): "пациент", "patient". */
  one?: string
  /** Russian 2 to 4, 22 to 24…: "пациента". */
  few?: string
  /** Russian 0, 5 to 20, 25…: "пациентов". */
  many?: string
  /** Everything else: the English plural "patients", the one Azerbaijani form "pasiyent", Russian after a fraction. */
  other?: string
}

/**
 * Picks the form of a noun that goes with a number. English has two forms, Russian three, and in Azerbaijani
 * the noun does not change after a number, so one form is enough: `{ other: 'pasiyent' }`.
 */
export function plural(count: number, forms: PluralForms, locale?: string): string {
  const lang = langOf(locale)
  const n = Math.abs(count)
  const pickFirst = (...keys: Array<keyof PluralForms>) => {
    for (const k of keys) if (forms[k] !== undefined) return forms[k] as string
    return ''
  }
  if (lang === 'az') return pickFirst('other', 'one')
  if (lang === 'en') return n === 1 ? pickFirst('one', 'other') : pickFirst('other', 'one')
  if (n % 1 !== 0) return pickFirst('other', 'few', 'many', 'one')
  const last = n % 10
  const lastTwo = n % 100
  if (last === 1 && lastTwo !== 11) return pickFirst('one', 'other')
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return pickFirst('few', 'other')
  return pickFirst('many', 'other')
}

/** A number with its noun: "214 pasiyent", "214 пациентов", "214 patients". The two never break apart. */
export function formatCount(count: number, forms: PluralForms, locale?: string): string {
  return formatNumber(count, { locale }) + NBSP + plural(count, forms, locale)
}

const AGE: Record<Lang, Record<'y' | 'm' | 'w' | 'd', PluralForms>> = {
  az: { y: { other: 'yaş' }, m: { other: 'ay' }, w: { other: 'həftə' }, d: { other: 'gün' } },
  ru: {
    y: { one: 'год', few: 'года', many: 'лет' },
    m: { one: 'месяц', few: 'месяца', many: 'месяцев' },
    w: { one: 'неделя', few: 'недели', many: 'недель' },
    d: { one: 'день', few: 'дня', many: 'дней' },
  },
  en: {
    y: { one: 'year', other: 'years' },
    m: { one: 'month', other: 'months' },
    w: { one: 'week', other: 'weeks' },
    d: { one: 'day', other: 'days' },
  },
}

export interface AgeOptions {
  /** The day the age is counted on, as YYYY-MM-DD or a Date. Default: today. For a deceased patient, the date of death. */
  on?: string | Date
  /** Language tag. Defaults to the page's `lang`. */
  locale?: string
}

/**
 * A patient's age from the date of birth, as precise as the age calls for: "5 gün", "3 həftə", "7 ay", "1 yaş 3 ay", "4 yaş".
 * Months are shown until the second birthday, because vaccination schedules count in them. Returns '' when the date is missing or in the future.
 */
export function formatAge(birth: string | Date, options: AgeOptions = {}): string {
  const b = toYmd(birth)
  const t = toYmd(options.on || new Date())
  if (!b || !t || daysBetween(b, t) < 0) return ''
  const lang = langOf(options.locale)
  const part = (n: number, unit: 'y' | 'm' | 'w' | 'd') => n + NBSP + plural(n, AGE[lang][unit], lang)
  let years = t.y - b.y
  let months = t.m - b.m
  if (t.d < b.d) months -= 1
  if (months < 0) {
    years -= 1
    months += 12
  }
  if (years >= 2) return part(years, 'y')
  if (years === 1) return part(1, 'y') + (months ? ` ${part(months, 'm')}` : '')
  if (months >= 1) return part(months, 'm')
  const days = daysBetween(b, t)
  return days >= 7 ? part(Math.floor(days / 7), 'w') : part(days, 'd')
}

const HOURS: Record<Lang, [string, string]> = { az: ['saat', 'dəq'], ru: ['ч', 'мин'], en: ['h', 'min'] }

/** A length of time from minutes, in the glossary's units: "30 dəq", "1 saat 30 dəq", "1 ч 30 мин", "1 h 30 min". */
export function formatDuration(minutes: number, locale?: string): string {
  if (!Number.isFinite(minutes) || minutes < 0) return ''
  const [hour, minute] = HOURS[langOf(locale)]
  const total = Math.round(minutes)
  const h = Math.floor(total / 60)
  const m = total % 60
  const parts: string[] = []
  if (h) parts.push(h + NBSP + hour)
  if (m || !h) parts.push(m + NBSP + minute)
  return parts.join(' ')
}

/**
 * Writes a phone number the one way it is shown: "+994 50 123 45 67", with non-breaking spaces so it never splits across lines.
 * Takes an Azerbaijani number however it was typed ("0501234567", "994 50 123-45-67", "50 123 45 67").
 * A number from another country is kept as typed, with its spaces made non-breaking.
 */
export function formatPhone(text: string): string {
  const raw = (text || '').trim()
  if (!raw) return ''
  const international = raw.charAt(0) === '+' || raw.slice(0, 2) === '00'
  let digits = raw.replace(/\D/g, '')
  if (raw.slice(0, 2) === '00') digits = digits.slice(2)
  let local = ''
  if (digits.length === 12 && digits.slice(0, 3) === '994') local = digits.slice(3)
  else if (!international && digits.length === 10 && digits.charAt(0) === '0') local = digits.slice(1)
  else if (!international && digits.length === 9) local = digits
  if (local) return ['+994', local.slice(0, 2), local.slice(2, 5), local.slice(5, 7), local.slice(7, 9)].join(NBSP)
  return raw.replace(/[\s ]+/g, NBSP)
}

// The Azerbaijani alphabet in its own order: ç after c, ə after e, x after h, ı before i, q after k.
const AZ_ALPHABET = 'abcçdeəfgğhxıijkqlmnoöprsştuüvyz'
function azRanks(text: string): number[] {
  // "I" is the capital of "ı" and "İ" of "i": lower-case them by hand, the plain rule gets both wrong
  const lower = text.replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase()
  const ranks: number[] = []
  for (const ch of lower) {
    const at = AZ_ALPHABET.indexOf(ch)
    const code = ch.codePointAt(0) as number
    // spaces, digits and punctuation first, then the alphabet, then any other letter
    ranks.push(at >= 0 ? 1000 + at : code < 128 ? code : 2000 + code)
  }
  return ranks
}

/**
 * Compares two pieces of text for sorting, in the order of the interface language: `names.sort(Vetora.compareText)`.
 * Azerbaijani follows its own alphabet ("Çingiz" after "Cavid", "Əli" after "Elçin", "Xədicə" after "Həsən"), which browsers do not know.
 * Capitals and small letters sort together.
 */
export function compareText(a: string, b: string, locale?: string): number {
  const lang = langOf(locale)
  if (lang !== 'az') return a.localeCompare(b, lang, { sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0)
  const x = azRanks(a)
  const y = azRanks(b)
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i]
  return x.length - y.length || (a < b ? -1 : a > b ? 1 : 0)
}
