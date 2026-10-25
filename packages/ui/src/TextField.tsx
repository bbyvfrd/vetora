import * as React from 'react'
import { Icon } from './Icon.js'
import type { IconName } from './icons.js'
import { cx } from './util.js'

export interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Visible label above the field. Always required. */
  label: string
  /** Hide the label visually (search boxes, table filters). It stays the accessible name. */
  hideLabel?: boolean
  /** Helper text under the field. */
  hint?: string
  /** Error message. Replaces the hint and marks the field invalid. */
  error?: string
  /** sm 28px, md 36px (default). */
  size?: 'sm' | 'md'
  /** Icon inside the field, before the value. */
  icon?: IconName
  /** Short unit or suffix after the value: "kg", "₼". */
  suffix?: string
}

/** A single-line text input with its label, hint and error. */
export function TextField({
  label,
  hideLabel,
  hint,
  error,
  size = 'md',
  icon,
  suffix,
  id,
  className,
  required,
  disabled,
  ...rest
}: TextFieldProps) {
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
      <div className={cx('vt-input', `vt-input-${size}`, error && 'is-invalid', disabled && 'is-disabled')}>
        {icon ? <Icon name={icon} size={size === 'sm' ? 'sm' : 'md'} /> : null}
        <input
          {...rest}
          id={fieldId}
          required={required}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? msgId : undefined}
        />
        {suffix ? <span className="vt-input-suffix">{suffix}</span> : null}
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
