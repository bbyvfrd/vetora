import type * as React from 'react'
import { Icon } from './Icon.js'
import { cx } from './util.js'

export interface PageHeaderBack {
  /** Where back leads: "Patients". */
  label: string
  href?: string
  onClick?: (event: React.MouseEvent) => void
}

export interface PageHeaderProps {
  /** The page title, as an h1. One per screen. */
  title: string
  /** A line of supporting facts under the title: counts, dates, the record's owner. */
  subtitle?: React.ReactNode
  /** Link back to the parent list, shown above the title. */
  back?: PageHeaderBack
  /** Buttons on the right: at most one primary, placed last. */
  actions?: React.ReactNode
  /** Bottom slot, flush with the header's lower edge: Tabs or a filter row. */
  children?: React.ReactNode
  className?: string
}

/** The top of every page: where you are, and what you can do here. */
export function PageHeader({ title, subtitle, back, actions, children, className }: PageHeaderProps) {
  return (
    <header className={cx('vt-page-head', children ? 'has-tabs' : undefined, className)}>
      {back ? (
        back.href ? (
          <a className="vt-page-back" href={back.href} onClick={back.onClick}>
            <Icon name="arrow_back" size="sm" />
            <span>{back.label}</span>
          </a>
        ) : (
          <button type="button" className="vt-page-back" onClick={back.onClick}>
            <Icon name="arrow_back" size="sm" />
            <span>{back.label}</span>
          </button>
        )
      ) : null}
      <div className="vt-page-row">
        <div className="vt-page-titles">
          <h1>{title}</h1>
          {subtitle ? <p className="vt-page-sub">{subtitle}</p> : null}
        </div>
        {actions ? <div className="vt-page-actions">{actions}</div> : null}
      </div>
      {children ? <div className="vt-page-slot">{children}</div> : null}
    </header>
  )
}
