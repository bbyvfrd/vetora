import type * as React from 'react'
import { Icon } from './Icon.js'
import type { IconName } from './icons.js'
import { cx } from './util.js'

export interface EmptyStateProps {
  /** The icon of the thing that is missing: `pets` for patients, `event` for appointments. */
  icon?: IconName
  /** What is empty, in plain words: "No appointments today". */
  title: string
  /** One sentence on why, or what to do next. */
  children?: React.ReactNode
  /** The way forward: one primary Button, optionally a secondary one. */
  action?: React.ReactNode
  /** md (default) fills a page or a large panel. sm sits inside a card or a table. */
  size?: 'md' | 'sm'
  className?: string
}

/** What a list, table or page shows when it has nothing to show. */
export function EmptyState({ icon, title, children, action, size = 'md', className }: EmptyStateProps) {
  return (
    <div className={cx('vt-empty', `vt-empty-${size}`, className)}>
      {icon ? (
        <span className="vt-empty-icon" aria-hidden="true">
          <Icon name={icon} size={size === 'sm' ? 'lg' : 'xl'} />
        </span>
      ) : null}
      <p className="vt-empty-title">{title}</p>
      {children ? <div className="vt-empty-text">{children}</div> : null}
      {action ? <div className="vt-empty-actions">{action}</div> : null}
    </div>
  )
}
