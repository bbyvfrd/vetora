import * as React from 'react'
import { type FieldProps, FieldShell } from './Field.js'
import { cx } from './util.js'

export interface TextAreaProps
  extends FieldProps,
    Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'id' | 'className' | 'disabled' | 'required'> {
  /** Lines shown at rest. Default 3. */
  rows?: number
  /** Grow with the text instead of scrolling, up to `maxRows`. */
  autoGrow?: boolean
  /** The tallest an auto-growing field gets before it scrolls. Default 12. */
  maxRows?: number
}

const LINE = 20

/** A multi-line text input with its label, hint and error. */
export function TextArea({
  label,
  hideLabel,
  hint,
  error,
  required,
  disabled,
  id,
  className,
  rows = 3,
  autoGrow = false,
  maxRows = 12,
  onInput,
  ...rest
}: TextAreaProps) {
  const auto = React.useId()
  const fieldId = id || auto
  const ref = React.useRef<HTMLTextAreaElement>(null)
  const fit = () => {
    const el = ref.current
    if (!el || !autoGrow) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, maxRows * LINE)}px`
  }
  React.useLayoutEffect(fit)
  // The text wraps differently once the font has loaded or the column changes width.
  React.useEffect(() => {
    if (!autoGrow) return
    if (document.fonts?.ready) document.fonts.ready.then(fit)
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  })
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
      <div className={cx('vt-input', 'vt-textarea', error && 'is-invalid', disabled && 'is-disabled')}>
        <textarea
          {...rest}
          ref={ref}
          id={fieldId}
          rows={rows}
          required={required}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${fieldId}-msg` : undefined}
          style={autoGrow ? { resize: 'none' } : undefined}
          onInput={(e) => {
            fit()
            if (onInput) onInput(e)
          }}
        />
      </div>
    </FieldShell>
  )
}
