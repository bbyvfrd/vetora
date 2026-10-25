/**
 * The names of months and weekdays in the three interface languages. Internal.
 * Carried here and not taken from the browser: Chrome has no Azerbaijani date names at all,
 * and browsers disagree on the Russian and English forms.
 */
export interface DateNames {
  /** As written after a day: "12 oktyabr", "12 октября", "12 October". */
  months: string[]
  /** As written alone or before a year, capitalised: "Oktyabr 2026", "Октябрь 2026". */
  monthsAlone: string[]
  /** Three-letter months, English only: "12 Oct 2026". */
  monthsShort?: string[]
  /** Sunday first. */
  days: string[]
  /** Sunday first, for the calendar's column headings. */
  daysShort: string[]
}

export const NAMES: Record<'az' | 'ru' | 'en', DateNames> = {
  az: {
    months: [
      'yanvar',
      'fevral',
      'mart',
      'aprel',
      'may',
      'iyun',
      'iyul',
      'avqust',
      'sentyabr',
      'oktyabr',
      'noyabr',
      'dekabr',
    ],
    monthsAlone: [
      'Yanvar',
      'Fevral',
      'Mart',
      'Aprel',
      'May',
      'İyun',
      'İyul',
      'Avqust',
      'Sentyabr',
      'Oktyabr',
      'Noyabr',
      'Dekabr',
    ],
    days: ['bazar', 'bazar ertəsi', 'çərşənbə axşamı', 'çərşənbə', 'cümə axşamı', 'cümə', 'şənbə'],
    daysShort: ['B.', 'B.e.', 'Ç.a.', 'Ç.', 'C.a.', 'C.', 'Ş.'],
  },
  ru: {
    months: [
      'января',
      'февраля',
      'марта',
      'апреля',
      'мая',
      'июня',
      'июля',
      'августа',
      'сентября',
      'октября',
      'ноября',
      'декабря',
    ],
    monthsAlone: [
      'Январь',
      'Февраль',
      'Март',
      'Апрель',
      'Май',
      'Июнь',
      'Июль',
      'Август',
      'Сентябрь',
      'Октябрь',
      'Ноябрь',
      'Декабрь',
    ],
    days: ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
    daysShort: ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'],
  },
  en: {
    months: [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ],
    monthsAlone: [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ],
    monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    daysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  },
}

export interface YMD {
  y: number
  m: number
  d: number
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

/**
 * Reads YYYY-MM-DD, or a Date in local time. Returns null for anything that is not a real date.
 * A timestamp string is refused on purpose: which day it falls on depends on the time zone, so it must come as a Date.
 */
export function toYmd(value: string | Date | undefined | null): YMD | null {
  if (!value) return null
  let v: YMD
  if (typeof value === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
    if (!m) return null
    v = { y: +m[1], m: +m[2], d: +m[3] }
  } else {
    if (Number.isNaN(value.getTime())) return null
    v = { y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate() }
  }
  const t = new Date(Date.UTC(v.y, v.m - 1, v.d))
  return t.getUTCFullYear() === v.y && t.getUTCMonth() === v.m - 1 && t.getUTCDate() === v.d ? v : null
}

/** 0 Sunday … 6 Saturday. */
export const weekday = (v: YMD) => new Date(Date.UTC(v.y, v.m - 1, v.d)).getUTCDay()
/** Whole days from a to b. */
export const daysBetween = (a: YMD, b: YMD) =>
  Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000)
export const two = (n: number) => pad(n)
