import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { Button } from './Button.js'
import { useModal } from './modal.js'
import { cx } from './util.js'

export interface DialogProps {
  /** Whether the dialog is shown. */
  open: boolean
  /** Heading of the dialog and its accessible name. Says what will happen: "Delete appointment?". */
  title: string
  /** Called on Escape, a click on the scrim, or the close button. */
  onClose: () => void
  /** sm 400px (confirmations), md 560px (forms, default), lg 800px (tables, two-column forms). */
  size?: 'sm' | 'md' | 'lg'
  /** The body: a sentence, or a form. */
  children?: React.ReactNode
  /** Buttons, right-aligned: the secondary action first, the main action last. */
  footer?: React.ReactNode
  /** Accessible name of the close button, in the interface language. */
  closeLabel?: string
  /** Set false when closing must be an explicit choice (unsaved clinical notes). Removes Escape and scrim-click closing. */
  dismissible?: boolean
}

/** A modal dialog over a scrim. Traps focus, closes on Escape, returns focus to where it came from. */
export function Dialog({
  open,
  title,
  onClose,
  size = 'md',
  children,
  footer,
  closeLabel = 'Close',
  dismissible = true,
}: DialogProps) {
  const { panel, onKeyDown } = useModal(open, onClose, dismissible)
  const titleId = React.useId()
  if (!open) return null

  const node = (
    <div
      className="vt-scrim"
      onMouseDown={(e) => (dismissible && e.target === e.currentTarget ? onClose() : undefined)}
    >
      <div
        ref={panel}
        className={cx('vt-dialog', `vt-dialog-${size}`)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="vt-dialog-head">
          <h2 id={titleId}>{title}</h2>
          <Button variant="ghost" size="sm" icon="close" iconOnly onClick={onClose}>
            {closeLabel}
          </Button>
        </header>
        <div className="vt-dialog-body">{children}</div>
        {footer ? <footer className="vt-dialog-foot">{footer}</footer> : null}
      </div>
    </div>
  )
  return ReactDOM.createPortal(node, document.body)
}
