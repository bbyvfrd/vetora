import type * as React from 'react'
import { Icon } from './Icon.js'
import type { IconName } from './icons.js'
import { cx, type Status } from './util.js'

export interface BadgeProps {
  /** What the badge means. neutral (default) for plain labels such as species or type. */
  status?: Status
  /** Solid fill instead of the tinted ground. For the one badge that must be seen first, such as an allergy alert. */
  solid?: boolean
  /** Icon before the text, drawn filled at 16px. */
  icon?: IconName
  /** One to three words. */
  children: React.ReactNode
  className?: string
}

/** A short status label. Always text, optionally with an icon; never colour alone. */
export function Badge({ status = 'neutral', solid = false, icon, children, className }: BadgeProps) {
  return (
    <span className={cx('vt-badge', `vt-badge-${status}`, solid && 'is-solid', className)}>
      {icon ? <Icon name={icon} filled size="sm" /> : null}
      <span>{children}</span>
    </span>
  )
}
