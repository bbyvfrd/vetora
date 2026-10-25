import type * as React from 'react'
import { Button } from './Button.js'
import { Icon } from './Icon.js'
import { cx, STATUS_ICON } from './util.js'

export interface MessageAction {
  label: string
  onClick: () => void
}

export interface BannerProps {
  /** What the message means. */
  status?: 'info' | 'success' | 'warning' | 'danger'
  /** The message in one line. Starts with the word that names it: "Allergy: penicillin". */
  title: string
  /** Optional detail under the title. */
  children?: React.ReactNode
  /** One follow-up action. */
  action?: MessageAction
  /** Shows a close button. Leave out for messages that must stay, such as allergy alerts. */
  onClose?: () => void
  /** Accessible name of the close button, in the interface language. */
  closeLabel?: string
  className?: string
}

/** A message that stays in the page, above the content it concerns. */
export function Banner({
  status = 'info',
  title,
  children,
  action,
  onClose,
  closeLabel = 'Close',
  className,
}: BannerProps) {
  return (
    <div className={cx('vt-banner', `vt-banner-${status}`, className)} role={status === 'danger' ? 'alert' : 'note'}>
      <Icon name={STATUS_ICON[status]} filled />
      <div className="vt-msg-text">
        <p className="vt-msg-title">{title}</p>
        {children ? <div className="vt-msg-body">{children}</div> : null}
      </div>
      {action ? (
        <Button variant="ghost" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
      {onClose ? (
        <Button variant="ghost" size="sm" icon="close" iconOnly onClick={onClose}>
          {closeLabel}
        </Button>
      ) : null}
    </div>
  )
}

export interface ToastProps {
  /** What the message means. */
  status?: 'info' | 'success' | 'warning' | 'danger'
  /** What just happened, in one line: "Invoice saved". */
  title: string
  /** Optional detail under the title. */
  children?: React.ReactNode
  /** One follow-up action, usually "Undo" or "View". */
  action?: MessageAction
  /** Shows a close button. */
  onClose?: () => void
  /** Accessible name of the close button, in the interface language. */
  closeLabel?: string
  className?: string
}

/** A short confirmation that floats over the page and leaves by itself. The consumer places and times it. */
export function Toast({
  status = 'success',
  title,
  children,
  action,
  onClose,
  closeLabel = 'Close',
  className,
}: ToastProps) {
  return (
    <div
      className={cx('vt-toast', `vt-toast-${status}`, className)}
      role={status === 'danger' || status === 'warning' ? 'alert' : 'status'}
    >
      <Icon name={STATUS_ICON[status]} filled />
      <div className="vt-msg-text">
        <p className="vt-msg-title">{title}</p>
        {children ? <div className="vt-msg-body">{children}</div> : null}
      </div>
      {action ? (
        <Button variant="ghost" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
      {onClose ? (
        <Button variant="ghost" size="sm" icon="close" iconOnly onClick={onClose}>
          {closeLabel}
        </Button>
      ) : null}
    </div>
  )
}
