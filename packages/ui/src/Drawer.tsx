import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { Button } from './Button.js'
import { useModal } from './modal.js'
import { cx } from './util.js'

export interface DrawerProps {
  /** Whether the drawer is shown. */
  open: boolean
  /** Heading of the drawer and its accessible name: the thing being looked at or edited. */
  title: string
  /** A line of supporting facts under the title. */
  subtitle?: React.ReactNode
  /** Called on Escape, a click on the scrim, or the close button. */
  onClose: () => void
  /** md 480px (a record at a glance, a short form; default), lg 720px (a long form, a visit note). */
  size?: 'md' | 'lg'
  /** The body. It scrolls; the title and footer stay in place. */
  children?: React.ReactNode
  /** Buttons, right-aligned: the secondary action first, the main action last. */
  footer?: React.ReactNode
  /** Accessible name of the close button, in the interface language. */
  closeLabel?: string
  /** Set false when closing would lose typed work. Removes Escape and scrim-click closing. */
  dismissible?: boolean
}

/** A panel that comes in from the right edge, for looking at or editing one record without leaving the list. */
export function Drawer({
  open,
  title,
  subtitle,
  onClose,
  size = 'md',
  children,
  footer,
  closeLabel = 'Close',
  dismissible = true,
}: DrawerProps) {
  const { panel, onKeyDown } = useModal(open, onClose, dismissible)
  const titleId = React.useId()
  if (!open) return null

  const node = (
    <div
      className="vt-scrim is-drawer"
      onMouseDown={(e) => (dismissible && e.target === e.currentTarget ? onClose() : undefined)}
    >
      <div
        ref={panel}
        className={cx('vt-drawer', `vt-drawer-${size}`)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="vt-drawer-head">
          <div className="vt-drawer-titles">
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <Button variant="ghost" size="sm" icon="close" iconOnly onClick={onClose}>
            {closeLabel}
          </Button>
        </header>
        <div className="vt-drawer-body">{children}</div>
        {footer ? <footer className="vt-drawer-foot">{footer}</footer> : null}
      </div>
    </div>
  )
  return ReactDOM.createPortal(node, document.body)
}
