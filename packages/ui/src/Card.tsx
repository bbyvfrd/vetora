import * as React from 'react'
import { cx } from './util.js'

export interface CardProps {
  /** Heading of the card. A card with a title becomes a named region. */
  title?: string
  /** Heading level of the title. Default 2: cards are the sections of a page. Use 3 inside a drawer, a dialog or under another h2. */
  headingLevel?: 2 | 3 | 4
  /** Supporting text under the title. */
  subtitle?: React.ReactNode
  /** Controls at the right of the heading: a ghost Button, a Menu. */
  actions?: React.ReactNode
  /** The content. */
  children?: React.ReactNode
  /** A strip along the bottom, for a link to the full list or the card's buttons. */
  footer?: React.ReactNode
  /** md 16px (default, dense views), lg 24px (settings, forms), none for content that runs edge to edge such as a Table. */
  padding?: 'md' | 'lg' | 'none'
  className?: string
}

/** A bordered surface that groups related content on the page. */
export function Card({
  title,
  headingLevel = 2,
  subtitle,
  actions,
  children,
  footer,
  padding = 'md',
  className,
}: CardProps) {
  const id = React.useId()
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4'
  const head =
    title || actions ? (
      <header className="vt-card-head">
        <div className="vt-card-titles">
          {title ? <Heading id={id}>{title}</Heading> : null}
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions ? <div className="vt-card-actions">{actions}</div> : null}
      </header>
    ) : null
  const body = (
    <>
      {head}
      <div className="vt-card-body">{children}</div>
      {footer ? <footer className="vt-card-foot">{footer}</footer> : null}
    </>
  )
  const cls = cx('vt-card', `vt-card-pad-${padding}`, className)
  return title ? (
    <section className={cls} aria-labelledby={id}>
      {body}
    </section>
  ) : (
    <div className={cls}>{body}</div>
  )
}
