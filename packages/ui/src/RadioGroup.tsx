import * as React from 'react'
import { Icon } from './Icon.js'
import { cx } from './util.js'

export interface RadioOption {
  value: string
  label: string
  /** Helper text under the label. */
  hint?: string
  disabled?: boolean
}

export interface RadioGroupProps {
  /** The question the options answer. Shown above them and read out with each one. */
  label: string
  /** Hide the label visually. It stays the accessible name. */
  hideLabel?: boolean
  /** Two to five options. More than that belongs in a Select. */
  options: RadioOption[]
  /** The chosen value. Leave undefined, with `defaultValue`, to let the group keep its own state. */
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  /** vertical (default), or horizontal for two or three short options. */
  orientation?: 'vertical' | 'horizontal'
  /** Form field name. Generated when omitted. */
  name?: string
  hint?: string
  /** Error message. Replaces the hint. */
  error?: string
  required?: boolean
  /** Disables every option. */
  disabled?: boolean
  className?: string
}

/** A set of options of which exactly one can be chosen. */
export function RadioGroup({
  label,
  hideLabel,
  options,
  value,
  defaultValue,
  onChange,
  orientation = 'vertical',
  name,
  hint,
  error,
  required,
  disabled,
  className,
}: RadioGroupProps) {
  const auto = React.useId()
  const group = name || auto
  const message = error || hint
  return (
    <fieldset
      className={cx('vt-radio-group', className)}
      aria-describedby={message ? `${group}-msg` : undefined}
      aria-invalid={error ? true : undefined}
    >
      <legend className={cx('vt-label', hideLabel && 'vt-sr')}>
        {label}
        {required ? (
          <span className="vt-required" aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
      </legend>
      <div className={cx('vt-radio-list', `is-${orientation}`)}>
        {options.map((o, i) => {
          const off = disabled || o.disabled
          const optId = `${group}-${i}`
          return (
            <div key={o.value} className={cx('vt-check', off && 'is-disabled')}>
              <span className="vt-check-box">
                <input
                  id={optId}
                  type="radio"
                  name={group}
                  value={o.value}
                  required={required}
                  disabled={off}
                  checked={value !== undefined ? value === o.value : undefined}
                  defaultChecked={value === undefined ? defaultValue === o.value : undefined}
                  onChange={() => onChange?.(o.value)}
                  aria-describedby={o.hint ? `${optId}-hint` : undefined}
                />
                <span className="vt-radio-mark" aria-hidden="true" />
              </span>
              <span className="vt-check-text">
                <label htmlFor={optId}>{o.label}</label>
                {o.hint ? (
                  <span id={`${optId}-hint`} className="vt-check-hint">
                    {o.hint}
                  </span>
                ) : null}
              </span>
            </div>
          )
        })}
      </div>
      {message ? (
        <p id={`${group}-msg`} className={cx('vt-field-msg', error && 'is-error')}>
          {error ? <Icon name="error" filled size="sm" /> : null}
          <span>{message}</span>
        </p>
      ) : null}
    </fieldset>
  )
}
