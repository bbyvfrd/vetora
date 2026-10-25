import * as React from 'react'
import { Icon } from './Icon.js'
import { cx } from './util.js'

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Text beside the box. Always required; clicking it toggles the box. */
  label: string
  /** Mixed state for a "select all" box when only some rows are selected. */
  indeterminate?: boolean
  /** Helper text under the label. */
  hint?: string
}

/** A checkbox for options that can each be on or off, saved with the form. */
export function Checkbox({ label, indeterminate = false, hint, id, className, disabled, ...rest }: CheckboxProps) {
  const auto = React.useId()
  const fieldId = id || auto
  const ref = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])
  return (
    <div className={cx('vt-check', disabled && 'is-disabled', className)}>
      <span className="vt-check-box">
        <input
          {...rest}
          ref={ref}
          id={fieldId}
          type="checkbox"
          disabled={disabled}
          aria-describedby={hint ? `${fieldId}-hint` : undefined}
        />
        <span className="vt-check-mark" aria-hidden="true">
          {indeterminate ? <span className="vt-check-dash" /> : <Icon name="check" size="sm" />}
        </span>
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
