import type * as React from 'react'
import { Badge } from './Badge.js'
import { Icon } from './Icon.js'
import type { IconName } from './icons.js'
import { cx, type Status } from './util.js'

export interface TimelineItem {
  id: string
  /** What happened or is due: the vaccine, the visit. */
  title: string
  /** When, already written for the interface language: "14.03.2026". */
  date: string
  /** A line of supporting facts: who did it, the batch, the next step. */
  detail?: React.ReactNode
  /** Colours the marker and the badge. Leave out for an ordinary past entry. */
  status?: Status
  /** The status in words, shown as a badge: "Overdue", "Due in 5 days". Required whenever `status` is set. */
  statusLabel?: string
  /** Icon in the marker. Defaults to one that fits the status. */
  icon?: IconName
  /** Still to come: the marker is drawn hollow. */
  upcoming?: boolean
  /** A control at the right: one ghost sm Button. */
  action?: React.ReactNode
}

export interface TimelineProps {
  /** Names the list for screen readers: "Vaccinations". */
  label: string
  /** In the order they should be read: what needs attention first, then newest to oldest. */
  items: TimelineItem[]
  className?: string
}

const DEFAULT_ICON: Record<Status, IconName> = {
  neutral: 'check',
  info: 'event',
  success: 'check',
  warning: 'schedule',
  danger: 'priority_high',
}

/** Dated entries down a line: a patient's vaccinations, their visits, what is due next. */
export function Timeline({ label, items, className }: TimelineProps) {
  return (
    <ol className={cx('vt-timeline', className)} aria-label={label}>
      {items.map((item) => {
        const status = item.status || 'neutral'
        return (
          <li key={item.id}>
            <span className={cx('vt-tl-mark', `vt-tl-${status}`, item.upcoming && 'is-upcoming')} aria-hidden="true">
              <Icon
                name={item.icon || (item.upcoming && status === 'neutral' ? 'event' : DEFAULT_ICON[status])}
                size="sm"
              />
            </span>
            <div className="vt-tl-body">
              <div className="vt-tl-head">
                <span className="vt-tl-title">{item.title}</span>
                {item.statusLabel ? <Badge status={status}>{item.statusLabel}</Badge> : null}
              </div>
              <span className="vt-tl-date">{item.date}</span>
              {item.detail ? <div className="vt-tl-detail">{item.detail}</div> : null}
            </div>
            {item.action ? <div className="vt-tl-action">{item.action}</div> : null}
          </li>
        )
      })}
    </ol>
  )
}
