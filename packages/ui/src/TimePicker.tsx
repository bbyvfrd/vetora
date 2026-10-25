import * as React from 'react'
import { type FieldProps, FieldShell, reveal, useOutside } from './Field.js'
import { Icon } from './Icon.js'
import { cx } from './util.js'

export interface TimePickerProps extends FieldProps {
  /** The time as HH:MM on the 24-hour clock, or '' for none. */
  value: string
  /** Called with HH:MM, or '' when the field is emptied. */
  onChange: (value: string) => void
  /** Minutes between the times in the list. Default 15. */
  step?: number
  /** First time in the list. Default 08:00. A time outside the list can still be typed. */
  min?: string
  /** Last time in the list. Default 20:00. */
  max?: string
  /** sm 28px, md 36px (default). */
  size?: 'sm' | 'md'
  /** Shown when the typed text is not a time: "Enter a time as 14:30". */
  invalidMessage?: string
  /** Form field name. The submitted value is HH:MM. */
  name?: string
  /** Open on first render (for documentation and tests). */
  defaultOpen?: boolean
}

const pad = (n: number) => String(n).padStart(2, '0')
const minutes = (hhmm: string) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5)
const clock = (total: number) => `${pad(Math.floor(total / 60))}:${pad(total % 60)}`

/** Reads what a person typed: "9", "930", "9.30", "09:30" all mean a time. */
function parseTime(text: string): string | null {
  const parts = text.trim().split(/\D+/).filter(Boolean)
  let h = NaN
  let m = NaN
  if (parts.length === 2 && parts[1].length === 2) {
    h = +parts[0]
    m = +parts[1]
  } else if (parts.length === 1) {
    const s = parts[0]
    if (s.length <= 2) {
      h = +s
      m = 0
    } else if (s.length <= 4) {
      h = +s.slice(0, s.length - 2)
      m = +s.slice(-2)
    }
  }
  return h >= 0 && h <= 23 && m >= 0 && m <= 59 ? `${pad(h)}:${pad(m)}` : null
}

/** A time field on the 24-hour clock: type the time, or pick it from a list of slots. */
export function TimePicker({
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
  step = 15,
  min = '08:00',
  max = '20:00',
  size = 'md',
  invalidMessage,
  name,
  defaultOpen = false,
}: TimePickerProps) {
  const auto = React.useId()
  const fieldId = id || auto
  const listId = `${fieldId}-list`
  const options = React.useMemo(() => {
    const out: string[] = []
    for (let t = minutes(min); t <= minutes(max); t += Math.max(1, step)) out.push(clock(t))
    return out
  }, [min, max, step])
  const nearest = (hhmm: string) => {
    if (!/^\d\d:\d\d$/.test(hhmm)) return 0
    const i = options.findIndex((o) => o >= hhmm)
    return i < 0 ? options.length - 1 : i
  }

  const [text, setText] = React.useState(value)
  const [bad, setBad] = React.useState(false)
  const [open, setOpen] = React.useState(defaultOpen)
  const [active, setActive] = React.useState(nearest(value))
  const wrap = React.useRef<HTMLDivElement>(null)
  const input = React.useRef<HTMLInputElement>(null)
  const wasOpen = React.useRef(false)

  React.useEffect(() => {
    setText(value)
    setBad(false)
  }, [value])
  useOutside(wrap, open, () => setOpen(false))
  React.useEffect(() => {
    if (!open || !wrap.current) {
      wasOpen.current = false
      return
    }
    const list = wrap.current.querySelector<HTMLElement>('[role="listbox"]')
    reveal(list, list && (list.children[active] as HTMLElement), !wasOpen.current)
    wasOpen.current = true
  }, [open, active, listId])

  const commit = () => {
    if (!text.trim()) {
      setBad(false)
      if (value) onChange('')
      return
    }
    const t = parseTime(text)
    if (!t) {
      setBad(true)
      return
    }
    setBad(false)
    setText(t)
    if (t !== value) onChange(t)
  }
  const show = () => {
    setActive(nearest(parseTime(text) || value))
    setOpen(true)
  }
  const choose = (t: string) => {
    setBad(false)
    setText(t)
    setOpen(false)
    if (t !== value) onChange(t)
    if (input.current) input.current.focus()
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) show()
      else setActive((i) => Math.max(0, Math.min(options.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))))
    } else if (e.key === 'Enter') {
      if (open && options[active]) {
        e.preventDefault()
        choose(options[active])
      } else commit()
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation()
      setOpen(false)
    }
  }
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
            placeholder="00:00"
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-autocomplete="none"
            aria-activedescendant={open ? `${listId}-${active}` : undefined}
            aria-invalid={error || bad ? true : undefined}
            aria-describedby={shown || hint ? `${fieldId}-msg` : undefined}
            value={text}
            required={required}
            disabled={disabled}
            onChange={(e) => {
              setText(e.target.value)
              setBad(false)
            }}
            onBlur={commit}
            onKeyDown={onKeyDown}
          />
          <button
            type="button"
            className="vt-input-btn"
            tabIndex={-1}
            aria-hidden="true"
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (open) setOpen(false)
              else {
                show()
                input.current?.focus()
              }
            }}
          >
            <Icon name="schedule" size={size === 'sm' ? 'sm' : 'md'} />
          </button>
        </div>
        {name ? <input type="hidden" name={name} value={value} /> : null}
        {open ? (
          <ul id={listId} className="vt-listbox is-narrow" role="listbox" aria-labelledby={`${fieldId}-label`}>
            {options.map((t, i) => (
              <li
                key={t}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={t === value}
                className={cx('vt-option', i === active && 'is-active', t === value && 'is-selected')}
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => setActive(i)}
                onClick={() => choose(t)}
              >
                <span className="vt-option-label">{t}</span>
                {t === value ? <Icon name="check" size="sm" /> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </FieldShell>
  )
}
