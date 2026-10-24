import type * as React from 'react'
import { Icon } from './Icon.js'
import type { IconName } from './icons.js'
import { cx } from './util.js'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary: the one main action of a view. secondary (default): everything else. ghost: low-emphasis, toolbars and rows. danger: destructive, in the confirm step. */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  /** sm 28px, md 36px (default), lg 44px. */
  size?: 'sm' | 'md' | 'lg'
  /** Icon before the label. */
  icon?: IconName
  /** Icon after the label, for menus and "next" actions. */
  iconEnd?: IconName
  /** Show only the icon. The children still give the button its accessible name. */
  iconOnly?: boolean
  /** Replaces the icon with a spinner and blocks clicks. */
  loading?: boolean
  /** Stretches the button across its container: the one action of a sign-in form or a narrow card. */
  fullWidth?: boolean
}

/** A button. Verb first, sentence case. */
export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconEnd,
  iconOnly = false,
  loading = false,
  fullWidth = false,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const iconSize = size === 'sm' ? 'sm' : size === 'lg' ? 'lg' : 'md'
  return (
    <button
      type={type}
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'vt-btn',
        `vt-btn-${variant}`,
        `vt-btn-${size}`,
        iconOnly && 'vt-btn-icon',
        fullWidth && 'vt-btn-block',
        loading && 'is-loading',
        className,
      )}
    >
      {loading ? (
        <span className="vt-spinner" aria-hidden="true" />
      ) : icon ? (
        <Icon name={icon} size={iconSize} />
      ) : null}
      {iconOnly ? <span className="vt-sr">{children}</span> : <span className="vt-btn-label">{children}</span>}
      {iconEnd && !iconOnly ? <Icon name={iconEnd} size={iconSize} /> : null}
    </button>
  )
}
