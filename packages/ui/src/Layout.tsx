import * as React from 'react'
import { cx } from './util.js'

export interface AppShellProps {
  /** The NavRail. */
  nav: React.ReactNode
  /** Text of the link that jumps past the navigation, in the interface language: "Skip to content". It shows on keyboard focus. */
  skipLabel: string
  /** The page: a PageHeader or PatientHeader, a PageBody, and on form pages FormActions. */
  children: React.ReactNode
  /** Height of the frame: a number is pixels. Default: the whole window. */
  height?: number | string
  className?: string
}

/** The frame of every signed-in screen: the navigation rail on the left, the page scrolling beside it. */
export function AppShell({ nav, skipLabel, children, height, className }: AppShellProps) {
  const id = React.useId()
  const main = React.useRef<HTMLElement>(null)
  return (
    <div className={cx('vt-app', className)} style={height !== undefined ? { height } : undefined}>
      <a
        className="vt-skip"
        href={`#${id}`}
        onClick={(event) => {
          // Browsers differ on whether a fragment link focuses its target, so the link focuses the page itself
          // (vetora ticket #12, a repo change under ADR 0005).
          event.preventDefault()
          main.current?.focus()
        }}
      >
        {skipLabel}
      </a>
      {nav}
      <main id={id} ref={main} className="vt-app-main" tabIndex={-1}>
        {children}
      </main>
    </div>
  )
}

export interface PageBodyProps {
  /** full (default): lists, records, the schedule. narrow: one column of reading width, for forms. */
  width?: 'full' | 'narrow'
  /** A side column on the right, for what supports the main content: next appointment, contact details, history. */
  aside?: React.ReactNode
  /** Lets the body fill the height left under the header, for one thing that scrolls by itself: the schedule. */
  fill?: boolean
  /** The page's content: cards, a table, a form's sections. They stack with `space-4` between them. */
  children: React.ReactNode
  className?: string
}

/** The content area of a page, under its header: the page's padding, its widest measure and its columns. */
export function PageBody({ width = 'full', aside, fill = false, children, className }: PageBodyProps) {
  return (
    <div className={cx('vt-body', `vt-body-${width}`, aside ? 'has-aside' : undefined, fill && 'is-fill', className)}>
      <div className="vt-body-main">{children}</div>
      {aside ? <aside className="vt-body-aside">{aside}</aside> : null}
    </div>
  )
}

export interface FilterBarProps {
  /** Names the group for screen readers: "Filters". */
  label: string
  /** The search field first, then the filters: fields with `hideLabel`. */
  children: React.ReactNode
  /** Controls pushed to the right: a view switch, export, the key to colours. */
  actions?: React.ReactNode
  className?: string
}

/** The row of search and filters above a table or the schedule. */
export function FilterBar({ label, children, actions, className }: FilterBarProps) {
  return (
    <div className={cx('vt-filterbar', className)} role="group" aria-label={label}>
      <div className="vt-filterbar-fields">{children}</div>
      {actions ? <div className="vt-filterbar-actions">{actions}</div> : null}
    </div>
  )
}

export interface FormSectionProps {
  /** Heading of the group of fields, as an h2: "Patient", "Working hours". */
  title: string
  /** One or two sentences on what the group is for, or what changing it affects. */
  description?: React.ReactNode
  /** stacked (default): heading above the fields, for forms. side: heading and description to the left of the fields, for settings. */
  layout?: 'stacked' | 'side'
  /** Columns the fields are laid out in. Default 2. Give a field `className="vt-span-all"` to cross them all. */
  columns?: 1 | 2 | 3
  /** The fields. */
  children: React.ReactNode
  className?: string
}

/** A titled group of fields on a form or settings page. */
export function FormSection({
  title,
  description,
  layout = 'stacked',
  columns = 2,
  children,
  className,
}: FormSectionProps) {
  const id = React.useId()
  return (
    <section className={cx('vt-form-section', `is-${layout}`, className)} aria-labelledby={id}>
      <div className="vt-form-intro">
        <h2 id={id}>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      <div className={cx('vt-form-fields', `vt-form-cols-${columns}`)}>{children}</div>
    </section>
  )
}

export interface FormActionsProps {
  /** The buttons: the way out first, the one primary action last. */
  children: React.ReactNode
  /** A line on the left: "Unsaved changes", or how many fields need attention. */
  note?: React.ReactNode
  className?: string
}

/** The bar of a form's buttons, held at the bottom of the page so saving is always in reach. */
export function FormActions({ children, note, className }: FormActionsProps) {
  return (
    <div className={cx('vt-form-actions', className)}>
      {note ? (
        <p className="vt-form-note" role="status">
          {note}
        </p>
      ) : null}
      <div className="vt-form-buttons">{children}</div>
    </div>
  )
}

export interface DetailItem {
  /** What the value is: "Phone", "Address". */
  label: string
  /** The value: text, a link, a Badge. Left empty, `emptyText` is shown. */
  value?: React.ReactNode
}

export interface DetailListProps {
  items: DetailItem[]
  /** 1 (default): label beside value, one pair per row, for cards and side columns. 2 or 3: label above value in a grid, for wide panels. */
  columns?: 1 | 2 | 3
  /** What a missing value shows. Default a dash. */
  emptyText?: string
  className?: string
}

/** Labelled facts about a record, to be read, not edited: a client's contact details, an appointment's particulars. */
export function DetailList({ items, columns = 1, emptyText = '—', className }: DetailListProps) {
  return (
    <dl className={cx('vt-details', `vt-details-cols-${columns}`, className)}>
      {items.map((item) => {
        const empty = item.value === undefined || item.value === null || item.value === ''
        return (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd className={cx(empty && 'is-empty')}>{empty ? emptyText : item.value}</dd>
          </div>
        )
      })}
    </dl>
  )
}

export interface AuthLayoutProps {
  /** The brand panel's content: the stacked reversed logo, and a line about the product under it. */
  brand: React.ReactNode
  /** Heading of the form, the page's h1: "Sign in". */
  title: string
  /** A line under the heading. */
  subtitle?: React.ReactNode
  /** The form. */
  children: React.ReactNode
  /** Called when the form is submitted (Enter in a field, or the button). Give it, and the fields are wrapped in a form. */
  onSubmit?: (event: React.FormEvent) => void
  /** Under the form: the language choice, a link to help. */
  footer?: React.ReactNode
  /** Height of the page: a number is pixels. Default: the whole window. */
  height?: number | string
  className?: string
}

/** The page outside the app, before anyone is signed in: the brand on one side, one short form on the other. */
export function AuthLayout({ brand, title, subtitle, children, onSubmit, footer, height, className }: AuthLayoutProps) {
  const body = (
    <>
      <h1>{title}</h1>
      {subtitle ? <p className="vt-auth-sub">{subtitle}</p> : null}
      {children}
    </>
  )
  return (
    <div className={cx('vt-auth', className)} style={height !== undefined ? { height } : undefined}>
      {/* A header, the page's banner landmark, so the brand is not content outside every landmark beside the main
          (vetora ticket #19, a repo change under ADR 0005). */}
      <header className="vt-auth-brand">{brand}</header>
      <main className="vt-auth-main">
        {onSubmit ? (
          <form className="vt-auth-form" noValidate onSubmit={onSubmit}>
            {body}
          </form>
        ) : (
          <div className="vt-auth-form">{body}</div>
        )}
        {footer ? <div className="vt-auth-foot">{footer}</div> : null}
      </main>
    </div>
  )
}
