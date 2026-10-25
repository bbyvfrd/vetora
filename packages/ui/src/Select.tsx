import * as React from 'react'
import { Icon } from './Icon.js'
import { cx } from './util.js'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  /** Visible label above the field. Always required. */
  label: string
  /** Hide the label visually. It stays the accessible name. */
  hideLabel?: boolean
  /** The choices, in the order they should appear. */
  options: SelectOption[]
  /** Shown while nothing is chosen. */
  placeholder?: string
  /** Helper text under the field. */
  hint?: string
  /** Error message. Replaces the hint and marks the field invalid. */
  error?: string
  /** sm 28px, md 36px (default). */
  size?: 'sm' | 'md'
}

/** A dropdown for choosing one value from a short, known list. Uses the browser's own list. */
export function Select({
  label,
  hideLabel,
  options,
  placeholder,
  hint,
  error,
  size = 'md',
  id,
  className,
  required,
  disabled,
  ...rest
}: SelectProps) {
  const auto = React.useId()
  const fieldId = id || auto
  const msgId = `${fieldId}-msg`
  const message = error || hint
  return (
    <div className={cx('vt-field', className)}>
      <label className={cx('vt-label', hideLabel && 'vt-sr')} htmlFor={fieldId}>
        {label}
        {required ? (
          <span className="vt-required" aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
      </label>
      <div
        className={cx('vt-input', 'vt-select', `vt-input-${size}`, error && 'is-invalid', disabled && 'is-disabled')}
      >
        <select
          {...rest}
          id={fieldId}
          required={required}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? msgId : undefined}
        >
          {placeholder ? <option value="">{placeholder}</option> : null}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <Icon name="keyboard_arrow_down" size={size === 'sm' ? 'sm' : 'md'} />
      </div>
      {message ? (
        <p id={msgId} className={cx('vt-field-msg', error && 'is-error')}>
          {error ? <Icon name="error" filled size="sm" /> : null}
          <span>{message}</span>
        </p>
      ) : null}
    </div>
  )
}
