import type * as React from 'react'
import { Icon } from './Icon.js'
import type { IconName } from './icons.js'
import { cx } from './util.js'

export interface NavItem {
  id: string
  label: string
  icon: IconName
  /** Makes the item a link. Without it the item is a button. */
  href?: string
  /** A count at the end of the item: unread results, tasks due. */
  badge?: number | string
}

export interface NavSection {
  /** Optional heading above a group of items. */
  label?: string
  items: NavItem[]
}

export interface NavAccount {
  /** The signed-in person's name. */
  name: string
  /** Their role or clinic, on a second line. */
  detail?: string
  /** Where the account opens: the profile page. Without it the entry is a button. */
  href?: string
  onClick?: (event: React.MouseEvent) => void
}

export interface NavRailProps {
  /** Names the navigation for screen readers: "Main". */
  label: string
  /** Top slot: the reversed logo (horizontal lockup, or the mark alone when collapsed). */
  brand?: React.ReactNode
  sections: NavSection[]
  /** Id of the current page's item. */
  activeId?: string
  /** Called when an item is chosen. For links, call event.preventDefault() to route in-app. */
  onNavigate?: (id: string, event: React.MouseEvent) => void
  /** Icons only, 64px wide. Labels stay available to screen readers and as hover hints. */
  collapsed?: boolean
  /** The signed-in person, at the bottom of the rail. Opens their profile, where language and sign-out live. */
  account?: NavAccount
  /** Bottom slot, above the account: a clinic or branch switcher. */
  footer?: React.ReactNode
  className?: string
}

/** The main navigation, down the left edge on the navy surface. */
export function NavRail({
  label,
  brand,
  sections,
  activeId,
  onNavigate,
  collapsed = false,
  account,
  footer,
  className,
}: NavRailProps) {
  const who = account ? (
    <>
      <Icon name="account_circle" size="lg" />
      <span className={cx('vt-nav-who', collapsed && 'vt-sr')}>
        <span className="vt-nav-label">{account.name}</span>
        {/* A space between the two lines, so the entry's name reads "name detail", not the two run together; the
            flex column drops it from the layout (vetora ticket #19, a repo change under ADR 0005). */}
        {account.detail ? ' ' : null}
        {account.detail ? <span className="vt-nav-detail">{account.detail}</span> : null}
      </span>
    </>
  ) : null
  return (
    <nav className={cx('vt-nav', collapsed && 'is-collapsed', className)} aria-label={label}>
      {brand ? <div className="vt-nav-brand">{brand}</div> : null}
      <div className="vt-nav-scroll">
        {sections.map((section, i) => (
          <div className="vt-nav-section" key={i}>
            {section.label ? <p className={cx('vt-nav-heading', collapsed && 'vt-sr')}>{section.label}</p> : null}
            <ul>
              {section.items.map((item) => {
                const active = item.id === activeId
                const content = (
                  <>
                    <Icon name={item.icon} filled={active} />
                    <span className={cx('vt-nav-label', collapsed && 'vt-sr')}>{item.label}</span>
                    {item.badge !== undefined && !collapsed ? <span className="vt-nav-badge">{item.badge}</span> : null}
                  </>
                )
                const shared = {
                  className: cx('vt-nav-item', active && 'is-active'),
                  'aria-current': active ? ('page' as const) : undefined,
                  title: collapsed ? item.label : undefined,
                  onClick: (e: React.MouseEvent) => onNavigate?.(item.id, e),
                }
                return (
                  <li key={item.id}>
                    {item.href ? (
                      <a href={item.href} {...shared}>
                        {content}
                      </a>
                    ) : (
                      <button type="button" {...shared}>
                        {content}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
      {footer || account ? (
        <div className="vt-nav-foot">
          {footer}
          {account ? (
            account.href ? (
              <a
                className="vt-nav-item vt-nav-account"
                href={account.href}
                title={collapsed ? account.name : undefined}
                onClick={account.onClick}
              >
                {who}
              </a>
            ) : (
              <button
                type="button"
                className="vt-nav-item vt-nav-account"
                title={collapsed ? account.name : undefined}
                onClick={account.onClick}
              >
                {who}
              </button>
            )
          ) : null}
        </div>
      ) : null}
    </nav>
  )
}
