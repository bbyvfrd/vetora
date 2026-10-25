import * as React from 'react'
import { type FieldProps, FieldShell, reveal, useOutside } from './Field.js'
import { Icon } from './Icon.js'
import type { IconName } from './icons.js'
import { cx, fold } from './util.js'

export interface ComboOption {
  value: string
  /** The name shown in the list and, once chosen, in the field. */
  label: string
  /** A second line that tells look-alikes apart: "Cat · Aysel Məmmədova". It is searched too. */
  description?: string
  icon?: IconName
  disabled?: boolean
}

export interface ComboboxProps extends FieldProps {
  /** What can be chosen. With `filter={false}`, the options your search returned for the typed text. */
  options: ComboOption[]
  /** The chosen option's value, or null. */
  value: string | null
  /** Called with the chosen value and option, or with null when the field is cleared. */
  onChange: (value: string | null, option: ComboOption | null) => void
  /** The chosen value's label, for when it is not among `options` (a server search that has moved on). */
  valueLabel?: string
  /** Called as the person types. Use it to fetch options from a server. */
  onInputChange?: (text: string) => void
  /** Narrow the options to the typed text (default). Set false when the options already come filtered from a server. */
  filter?: boolean
  /** Shows the loading line in place of the options. */
  loading?: boolean
  /** The loading line: "Searching…". */
  loadingText?: string
  /** Shown when nothing matches, in the interface language: "No patients found". */
  emptyText: string
  /** Accessible name of the clear button. Defaults to "Clear": pass it translated. */
  clearLabel?: string
  placeholder?: string
  /** Icon inside the field. Default `search`. */
  icon?: IconName
  /** sm 28px, md 36px (default). */
  size?: 'sm' | 'md'
  /** Open on first render (for documentation and tests). */
  defaultOpen?: boolean
}

/** A field that searches a long list as you type and lets you choose one result: a patient, a client, a product. */
export function Combobox({
  label,
  hideLabel,
  hint,
  error,
  required,
  disabled,
  id,
  className,
  options,
  value,
  onChange,
  valueLabel,
  onInputChange,
  filter = true,
  loading = false,
  loadingText,
  emptyText,
  clearLabel = 'Clear',
  placeholder,
  icon = 'search',
  size = 'md',
  defaultOpen = false,
}: ComboboxProps) {
  const auto = React.useId()
  const fieldId = id || auto
  const listId = `${fieldId}-list`
  const last = React.useRef<ComboOption | null>(null)
  const found =
    options.find((o) => o.value === value) || (last.current && last.current.value === value ? last.current : null)
  const chosenLabel = value === null ? '' : found ? found.label : valueLabel || ''

  const [text, setText] = React.useState(chosenLabel)
  const [typing, setTyping] = React.useState(false)
  const [open, setOpen] = React.useState(defaultOpen)
  const [active, setActive] = React.useState(0)
  const wrap = React.useRef<HTMLDivElement>(null)
  const input = React.useRef<HTMLInputElement>(null)
  const wasOpen = React.useRef(false)

  React.useEffect(() => {
    setText(chosenLabel)
    setTyping(false)
  }, [value, chosenLabel])

  const query = fold(text.trim())
  const shown =
    filter && typing && query
      ? options.filter((o) => fold(`${o.label} ${o.description || ''}`).includes(query))
      : options
  const at = Math.min(active, Math.max(0, shown.length - 1))

  const shut = () => {
    setOpen(false)
    setTyping(false)
    setText(chosenLabel)
  }
  useOutside(wrap, open, shut)
  React.useEffect(() => {
    if (!open || !wrap.current) {
      wasOpen.current = false
      return
    }
    const list = wrap.current.querySelector<HTMLElement>('[role="listbox"]')
    reveal(list, list && (list.children[at] as HTMLElement), !wasOpen.current)
    wasOpen.current = true
  }, [open, at, listId])

  const choose = (o: ComboOption) => {
    if (o.disabled) return
    last.current = o
    setText(o.label)
    setTyping(false)
    setOpen(false)
    if (o.value !== value) onChange(o.value, o)
  }
  const step = (dir: 1 | -1) => {
    if (!shown.length) return
    let i = at
    for (let n = 0; n < shown.length; n++) {
      i = (i + dir + shown.length) % shown.length
      if (!shown[i].disabled) break
    }
    setActive(i)
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) setOpen(true)
      else step(e.key === 'ArrowDown' ? 1 : -1)
    } else if (e.key === 'Enter') {
      if (open && !loading && shown[at]) {
        e.preventDefault()
        choose(shown[at])
      }
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation()
      shut()
    }
  }

  return (
    <FieldShell
      fieldId={fieldId}
      label={label}
      hideLabel={hideLabel}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      <div
        ref={wrap}
        className="vt-pop-anchor"
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) shut()
        }}
      >
        <div
          className={cx('vt-input', `vt-input-${size}`, 'has-button', error && 'is-invalid', disabled && 'is-disabled')}
        >
          <Icon name={icon} size={size === 'sm' ? 'sm' : 'md'} />
          <input
            ref={input}
            id={fieldId}
            type="text"
            autoComplete="off"
            placeholder={placeholder}
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open && !loading && shown.length ? listId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={open && !loading && shown[at] ? `${listId}-${at}` : undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={error || hint ? `${fieldId}-msg` : undefined}
            value={text}
            required={required}
            disabled={disabled}
            onChange={(e) => {
              const next = e.target.value
              setText(next)
              setTyping(true)
              setOpen(true)
              setActive(0)
              if (onInputChange) onInputChange(next)
              if (!next && value !== null) onChange(null, null)
            }}
            onClick={() => setOpen(true)}
            onKeyDown={onKeyDown}
          />
          {value !== null && !disabled ? (
            <button
              type="button"
              className="vt-input-btn"
              aria-label={clearLabel}
              tabIndex={-1}
              onClick={() => {
                last.current = null
                onChange(null, null)
                setText('')
                setTyping(false)
                if (onInputChange) onInputChange('')
                if (input.current) input.current.focus()
              }}
            >
              <Icon name="close" size={size === 'sm' ? 'sm' : 'md'} />
            </button>
          ) : null}
        </div>
        {open ? (
          loading ? (
            <p className="vt-listbox vt-listbox-note" role="status">
              <span className="vt-spinner" aria-hidden="true" />
              <span>{loadingText}</span>
            </p>
          ) : shown.length ? (
            <ul id={listId} className="vt-listbox" role="listbox" aria-labelledby={`${fieldId}-label`}>
              {shown.map((o, i) => (
                <li
                  key={o.value}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={o.value === value}
                  aria-disabled={o.disabled || undefined}
                  className={cx(
                    'vt-option',
                    i === at && 'is-active',
                    o.value === value && 'is-selected',
                    o.disabled && 'is-disabled',
                  )}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => setActive(i)}
                  onClick={() => choose(o)}
                >
                  {o.icon ? <Icon name={o.icon} /> : null}
                  <span className="vt-option-label">
                    <span>{o.label}</span>
                    {o.description ? <span className="vt-option-desc">{o.description}</span> : null}
                  </span>
                  {o.value === value ? <Icon name="check" size="sm" /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="vt-listbox vt-listbox-note" role="status">
              {emptyText}
            </p>
          )
        ) : null}
      </div>
    </FieldShell>
  )
}
