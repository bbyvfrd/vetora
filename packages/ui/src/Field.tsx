import * as React from 'react'
import { Icon } from './Icon.js'
import { cx } from './util.js'

/** The props every labelled field shares. */
export interface FieldProps {
  /** Visible label above the field. Always required. */
  label: string
  /** Hide the label visually (toolbars, table filters). It stays the accessible name. */
  hideLabel?: boolean
  /** Helper text under the field. */
  hint?: string
  /** Error message. Replaces the hint and marks the field invalid. */
  error?: string
  /** Marks the label with an asterisk and the control as required. */
  required?: boolean
  disabled?: boolean
  id?: string
  className?: string
}

interface ShellProps extends FieldProps {
  fieldId: string
  children: React.ReactNode
}

/** Label, control and message, laid out the same way for every field. Internal. */
export function FieldShell({ fieldId, label, hideLabel, hint, error, required, className, children }: ShellProps) {
  const message = error || hint
  return (
    <div className={cx('vt-field', className)}>
      <label id={`${fieldId}-label`} className={cx('vt-label', hideLabel && 'vt-sr')} htmlFor={fieldId}>
        {label}
        {required ? (
          <span className="vt-required" aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
      </label>
      {children}
      {message ? (
        <p id={`${fieldId}-msg`} className={cx('vt-field-msg', error && 'is-error')}>
          {error ? <Icon name="error" filled size="sm" /> : null}
          <span>{message}</span>
        </p>
      ) : null}
    </div>
  )
}

/** Closes a popup on a press outside its wrapper. */
export function useOutside(wrap: React.RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  React.useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
    // `close` only ever closes, so the listener set up when the popup opened stays correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
}

/** Scrolls a list so one of its rows shows: centred when the list has just opened, otherwise by as little as needed. The page itself never scrolls. */
export function reveal(list: HTMLElement | null, row: HTMLElement | null, centre: boolean) {
  if (!list || !row) return
  if (centre) list.scrollTop = row.offsetTop - (list.clientHeight - row.offsetHeight) / 2
  else if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop
  else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight)
    list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight
}
