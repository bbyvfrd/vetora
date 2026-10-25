import * as React from 'react'
import { Button } from './Button.js'
import { NAMES } from './dates.js'
import { type FieldProps, FieldShell, useOutside } from './Field.js'
import { formatDate } from './format.js'
import { Icon } from './Icon.js'
import { cx } from './util.js'

export interface DatePickerLabels {
  /** Name of the calendar button and of the calendar: "Choose date". */
  open: string
  /** "Previous month". */
  previousMonth: string
  /** "Next month". */
  nextMonth: string
  /** The button that picks today: "Today". */
  today: string
}

export interface DatePickerProps extends FieldProps {
  /** The date as YYYY-MM-DD, or '' for none. */
  value: string
  /** Called with YYYY-MM-DD, or '' when the field is emptied. */
  onChange: (value: string) => void
  /** Earliest date allowed, YYYY-MM-DD. */
  min?: string
  /** Latest date allowed, YYYY-MM-DD. For a date of birth, today. */
  max?: string
  /** Language tag that sets the typed format and the month and weekday names. Defaults to the page's `lang`; plain "en" formats day first. */
  locale?: string
  /** First day of the week: 1 Monday (default), 0 Sunday. */
  weekStartsOn?: 0 | 1
  /** sm 28px, md 36px (default). */
  size?: 'sm' | 'md'
  /** The calendar's four labels, in the interface language. They default to English. */
  labels?: Partial<DatePickerLabels>
  /** Shown when the typed text is not a date or falls outside min and max: "Enter a date as 12.10.2026". */
  invalidMessage?: string
  /** Form field name. The submitted value is YYYY-MM-DD. */
  name?: string
  /** Open on first render (for documentation and tests). */
  defaultOpen?: boolean
}

interface YMD {
  y: number
  m: number
  d: number
}
type Part = 'day' | 'month' | 'year'
interface Pattern {
  order: Part[]
  sep: string
}

const DEFAULT_LABELS: DatePickerLabels = {
  open: 'Choose date',
  previousMonth: 'Previous month',
  nextMonth: 'Next month',
  today: 'Today',
}
const LETTERS: Record<string, [string, string, string]> = { az: ['gg', 'aa', 'iiii'], ru: ['дд', 'мм', 'гггг'] }

const pad = (n: number, width = 2) => String(n).padStart(width, '0')
const toIso = (v: YMD) => `${pad(v.y, 4)}-${pad(v.m)}-${pad(v.d)}`
const utc = (v: YMD) => new Date(Date.UTC(v.y, v.m - 1, v.d))
const fromUtc = (t: Date): YMD => ({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() })

function valid(v: YMD): boolean {
  const t = utc(v)
  return (
    v.y >= 1900 && v.y <= 2200 && t.getUTCFullYear() === v.y && t.getUTCMonth() === v.m - 1 && t.getUTCDate() === v.d
  )
}
function fromIso(text: string | undefined): YMD | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text || '')
  if (!m) return null
  const v = { y: +m[1], m: +m[2], d: +m[3] }
  return valid(v) ? v : null
}
const addDays = (v: YMD, n: number): YMD => fromUtc(new Date(Date.UTC(v.y, v.m - 1, v.d + n)))
function addMonths(v: YMD, n: number): YMD {
  const first = new Date(Date.UTC(v.y, v.m - 1 + n, 1))
  const y = first.getUTCFullYear()
  const m = first.getUTCMonth() + 1
  return { y, m, d: Math.min(v.d, new Date(Date.UTC(y, m, 0)).getUTCDate()) }
}
function todayYmd(): YMD {
  const t = new Date()
  return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() }
}

/** The order of day, month and year and the separator, as the locale writes a numeric date. */
function patternOf(locale: string): Pattern {
  if (locale.slice(0, 2) === 'az') return { order: ['day', 'month', 'year'], sep: '.' }
  let parts: Intl.DateTimeFormatPart[] = []
  try {
    parts = new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    }).formatToParts(new Date(Date.UTC(2001, 10, 22)))
  } catch (_e) {
    parts = []
  }
  const order = parts
    .filter((p) => p.type === 'day' || p.type === 'month' || p.type === 'year')
    .map((p) => p.type as Part)
  const literal = parts.find((p) => p.type === 'literal')
  if (order.length !== 3) return { order: ['day', 'month', 'year'], sep: '.' }
  return { order, sep: literal?.value.trim() || '.' }
}
function format(v: YMD, p: Pattern): string {
  return p.order.map((k) => (k === 'day' ? pad(v.d) : k === 'month' ? pad(v.m) : pad(v.y, 4))).join(p.sep)
}
/** Reads what a person typed: any separator, or none ("12102026"), and two-digit years. */
function parse(text: string, p: Pattern): YMD | null {
  let nums = text.trim().split(/\D+/).filter(Boolean)
  if (nums.length === 1 && (nums[0].length === 8 || nums[0].length === 6)) {
    const s = nums[0]
    const yearLen = s.length - 4
    nums = []
    let at = 0
    for (const k of p.order) {
      const len = k === 'year' ? yearLen : 2
      nums.push(s.slice(at, at + len))
      at += len
    }
  }
  if (nums.length !== 3) return null
  const got: Record<Part, number> = { day: 0, month: 0, year: 0 }
  let yearText = ''
  p.order.forEach((k, i) => {
    got[k] = +nums[i]
    if (k === 'year') yearText = nums[i]
  })
  let y = got.year
  if (yearText.length <= 2) y += y <= (new Date().getFullYear() % 100) + 10 ? 2000 : 1900
  const v = { y, m: got.month, d: got.day }
  return valid(v) ? v : null
}

function pageLocale(given?: string): string {
  const lang = given || (typeof document !== 'undefined' && document.documentElement.lang) || 'en'
  return lang === 'en' ? 'en-GB' : lang
}
function capital(text: string, locale: string): string {
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1)
}

interface Names {
  /** "October 2026". */
  month: (v: YMD) => string
  /** "Monday, 12 October 2026": the spoken name of a day. */
  full: (v: YMD) => string
  /** Weekday names, Sunday first. */
  weekdays: Array<{ short: string; long: string }>
}
function namesOf(locale: string): Names {
  // The three interface languages use the bundle's own names, the same as formatDate; any other language asks the browser.
  const lang = locale.slice(0, 2)
  if (lang === 'az' || lang === 'ru' || lang === 'en') {
    const n = NAMES[lang]
    return {
      month: (v) => formatDate(toIso(v), { style: 'month', locale: lang }),
      full: (v) => formatDate(toIso(v), { style: 'full', locale: lang }),
      weekdays: n.days.map((long, i) => ({ long, short: n.daysShort[i] })),
    }
  }
  const month = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const full = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' })
  const short = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
  const long = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' })
  return {
    month: (v) => capital(month.format(utc(v)), locale),
    full: (v) => full.format(utc(v)),
    // 1 January 2023 was a Sunday
    weekdays: Array.from({ length: 7 }, (_, i) => ({
      short: short.format(new Date(Date.UTC(2023, 0, 1 + i))),
      long: long.format(new Date(Date.UTC(2023, 0, 1 + i))),
    })),
  }
}

/** A date field: type the date, or pick it from a calendar. */
export function DatePicker({
  label,
  hideLabel,
  hint,
  error,
  required,
  disabled,
  id,
  className,
  value,
  onChange,
  min,
  max,
  locale,
  weekStartsOn = 1,
  size = 'md',
  labels,
  invalidMessage,
  name,
  defaultOpen = false,
}: DatePickerProps) {
  const auto = React.useId()
  const fieldId = id || auto
  const loc = pageLocale(locale)
  const L = { ...DEFAULT_LABELS, ...labels }
  const p = React.useMemo(() => patternOf(loc), [loc])
  const names = React.useMemo(() => namesOf(loc), [loc])
  const selected = fromIso(value)
  const today = todayYmd()
  const inRange = (v: YMD) => (!min || toIso(v) >= min) && (!max || toIso(v) <= max)
  const clamp = (v: YMD): YMD =>
    min && toIso(v) < min ? fromIso(min) || v : max && toIso(v) > max ? fromIso(max) || v : v

  const [text, setText] = React.useState(selected ? format(selected, p) : '')
  const [bad, setBad] = React.useState(false)
  const [open, setOpen] = React.useState(defaultOpen)
  const [focus, setFocus] = React.useState<YMD>(clamp(selected || today))
  const wrap = React.useRef<HTMLDivElement>(null)
  const input = React.useRef<HTMLInputElement>(null)
  const opener = React.useRef<HTMLButtonElement>(null)
  const moveFocus = React.useRef(false)

  React.useEffect(() => {
    const v = fromIso(value)
    setText(v ? format(v, p) : '')
    setBad(false)
  }, [value, p])
  useOutside(wrap, open, () => setOpen(false))
  React.useEffect(() => {
    if (!open || !moveFocus.current || !wrap.current) return
    moveFocus.current = false
    const el = wrap.current.querySelector<HTMLElement>(`[data-day="${toIso(focus)}"]`)
    if (el) el.focus()
  }, [open, focus])

  const commit = () => {
    if (!text.trim()) {
      setBad(false)
      if (value) onChange('')
      return
    }
    const v = parse(text, p)
    if (!v || !inRange(v)) {
      setBad(true)
      return
    }
    setBad(false)
    setText(format(v, p))
    if (toIso(v) !== value) onChange(toIso(v))
  }
  const openCalendar = () => {
    const typed = parse(text, p)
    setFocus(clamp((typed && inRange(typed) ? typed : null) || selected || today))
    moveFocus.current = true
    setOpen(true)
  }
  const close = (returnTo?: React.RefObject<HTMLElement | null>) => {
    setOpen(false)
    if (returnTo?.current) returnTo.current.focus()
  }
  const pick = (v: YMD) => {
    setBad(false)
    setText(format(v, p))
    if (toIso(v) !== value) onChange(toIso(v))
    close(input)
  }
  const go = (v: YMD) => {
    moveFocus.current = true
    setFocus(clamp(v))
  }
  const onGridKey = (e: React.KeyboardEvent) => {
    const dow = (utc(focus).getUTCDay() - weekStartsOn + 7) % 7
    if (e.key === 'ArrowLeft') go(addDays(focus, -1))
    else if (e.key === 'ArrowRight') go(addDays(focus, 1))
    else if (e.key === 'ArrowUp') go(addDays(focus, -7))
    else if (e.key === 'ArrowDown') go(addDays(focus, 7))
    else if (e.key === 'Home') go(addDays(focus, -dow))
    else if (e.key === 'End') go(addDays(focus, 6 - dow))
    else if (e.key === 'PageUp') go(addMonths(focus, e.shiftKey ? -12 : -1))
    else if (e.key === 'PageDown') go(addMonths(focus, e.shiftKey ? 12 : 1))
    else return
    e.preventDefault()
  }

  // The month on show
  const first = { y: focus.y, m: focus.m, d: 1 }
  const days = new Date(Date.UTC(focus.y, focus.m, 0)).getUTCDate()
  const lead = (utc(first).getUTCDay() - weekStartsOn + 7) % 7
  const cells: Array<YMD | null> = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let d = 1; d <= days; d++) cells.push({ y: focus.y, m: focus.m, d })
  while (cells.length % 7) cells.push(null)
  const weeks: Array<Array<YMD | null>> = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  const monthLabel = names.month(first)
  const weekdays = Array.from({ length: 7 }, (_, i) => names.weekdays[(weekStartsOn + i) % 7])
  const letters = LETTERS[loc.slice(0, 2)] || ['DD', 'MM', 'YYYY']
  const placeholder = p.order
    .map((k) => (k === 'day' ? letters[0] : k === 'month' ? letters[1] : letters[2]))
    .join(p.sep)
  const prevOff = !!min && toIso(addDays(first, -1)) < min
  const nextOff = !!max && toIso(addMonths(first, 1)) > max
  const shown = error || (bad ? invalidMessage : undefined)

  return (
    <FieldShell
      fieldId={fieldId}
      label={label}
      hideLabel={hideLabel}
      hint={hint}
      error={shown}
      required={required}
      className={className}
    >
      <div
        ref={wrap}
        className="vt-pop-anchor"
        onBlur={(e) => {
          if (open && !e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false)
        }}
      >
        <div
          className={cx(
            'vt-input',
            `vt-input-${size}`,
            'has-button',
            (error || bad) && 'is-invalid',
            disabled && 'is-disabled',
          )}
        >
          <input
            ref={input}
            id={fieldId}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder={placeholder}
            value={text}
            required={required}
            disabled={disabled}
            aria-invalid={error || bad ? true : undefined}
            aria-describedby={shown || hint ? `${fieldId}-msg` : undefined}
            onChange={(e) => {
              setText(e.target.value)
              setBad(false)
            }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              else if (e.key === 'ArrowDown' && e.altKey) {
                e.preventDefault()
                openCalendar()
              }
            }}
          />
          <button
            ref={opener}
            type="button"
            className="vt-input-btn"
            aria-label={L.open}
            aria-haspopup="dialog"
            aria-expanded={open}
            disabled={disabled}
            onClick={() => (open ? close() : openCalendar())}
          >
            <Icon name="calendar_month" size={size === 'sm' ? 'sm' : 'md'} />
          </button>
        </div>
        {name ? <input type="hidden" name={name} value={value} /> : null}
        {open ? (
          <div
            className="vt-cal"
            role="dialog"
            tabIndex={-1}
            aria-label={L.open}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                close(opener)
              }
            }}
          >
            <div className="vt-cal-head">
              <button
                type="button"
                className="vt-cal-nav"
                aria-label={L.previousMonth}
                disabled={prevOff}
                onClick={() => setFocus(clamp(addMonths(focus, -1)))}
              >
                <Icon name="chevron_left" />
              </button>
              <p className="vt-cal-month" aria-live="polite">
                {monthLabel}
              </p>
              <button
                type="button"
                className="vt-cal-nav"
                aria-label={L.nextMonth}
                disabled={nextOff}
                onClick={() => setFocus(clamp(addMonths(focus, 1)))}
              >
                <Icon name="chevron_right" />
              </button>
            </div>
            <table className="vt-cal-grid" role="grid" aria-label={monthLabel} onKeyDown={onGridKey}>
              <thead>
                <tr>
                  {weekdays.map((w) => (
                    <th key={w.long} scope="col" abbr={w.long}>
                      {w.short}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeks.map((week, wi) => (
                  <tr key={wi}>
                    {week.map((day, di) => {
                      if (!day) return <td key={di} />
                      const iso = toIso(day)
                      const isSelected = iso === value
                      return (
                        <td key={di} role="gridcell" aria-selected={isSelected}>
                          <button
                            type="button"
                            data-day={iso}
                            className={cx(
                              'vt-cal-day',
                              isSelected && 'is-selected',
                              iso === toIso(today) && 'is-today',
                            )}
                            tabIndex={iso === toIso(focus) ? 0 : -1}
                            aria-label={names.full(day)}
                            aria-current={iso === toIso(today) ? 'date' : undefined}
                            disabled={!inRange(day)}
                            onClick={() => pick(day)}
                          >
                            {day.d}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="vt-cal-foot">
              <Button variant="ghost" size="sm" icon="today" disabled={!inRange(today)} onClick={() => pick(today)}>
                {L.today}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </FieldShell>
  )
}
