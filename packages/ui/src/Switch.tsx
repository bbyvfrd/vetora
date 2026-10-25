import * as React from 'react'
import { cx } from './util.js'

export interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Text beside the switch. Always required; names the setting, not its state. */
  label: string
  /** Helper text under the label. */
  hint?: string
}

/** A switch for a setting that takes effect immediately, without a Save button. */
export function Switch({ label, hint, id, className, disabled, ...rest }: SwitchProps) {
  const auto = React.useId()
  const fieldId = id || auto
  return (
    <div className={cx('vt-switch', disabled && 'is-disabled', className)}>
      <span className="vt-switch-track">
        <input
          {...rest}
          id={fieldId}
          type="checkbox"
          role="switch"
          disabled={disabled}
          aria-describedby={hint ? `${fieldId}-hint` : undefined}
        />
        <span className="vt-switch-thumb" aria-hidden="true" />
      </span>
      <span className="vt-check-text">
        <label htmlFor={fieldId}>{label}</label>
        {hint ? (
          <span id={`${fieldId}-hint`} className="vt-check-hint">
            {hint}
          </span>
        ) : null}
      </span>
    </div>
  )
}
