import * as React from 'react'
import { Icon } from './Icon.js'
import type { IconName } from './icons.js'
import { cx } from './util.js'

export interface TabItem {
  id: string
  label: string
  icon?: IconName
  /** A count shown after the label: open invoices, results to review. */
  count?: number
  disabled?: boolean
}

export interface TabsProps {
  /** Names the set of tabs for screen readers: "Patient record". */
  label: string
  items: TabItem[]
  /** Id of the current tab. */
  value: string
  onChange: (id: string) => void
  /** When set, each tab gets the id "<idPrefix>-tab-<id>" and points at a panel "<idPrefix>-panel-<id>" that the consumer renders. */
  idPrefix?: string
  className?: string
}

/** Tabs that switch between views of the same record or list. The consumer renders the panel. */
export function Tabs({ label, items, value, onChange, idPrefix, className }: TabsProps) {
  const refs = React.useRef<Record<string, HTMLButtonElement | null>>({})
  const enabled = items.filter((t) => !t.disabled)
  const move = (to: TabItem | undefined) => {
    if (!to) return
    onChange(to.id)
    const el = refs.current[to.id]
    if (el) el.focus()
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = enabled.findIndex((t) => t.id === value)
    if (e.key === 'ArrowRight') move(enabled[(i + 1) % enabled.length])
    else if (e.key === 'ArrowLeft') move(enabled[(i - 1 + enabled.length) % enabled.length])
    else if (e.key === 'Home') move(enabled[0])
    else if (e.key === 'End') move(enabled[enabled.length - 1])
    else return
    e.preventDefault()
  }
  return (
    <div className={cx('vt-tabs', className)} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {items.map((t) => {
        const selected = t.id === value
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el
            }}
            type="button"
            role="tab"
            id={idPrefix ? `${idPrefix}-tab-${t.id}` : undefined}
            aria-controls={idPrefix ? `${idPrefix}-panel-${t.id}` : undefined}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={t.disabled}
            className={cx('vt-tab', selected && 'is-selected')}
            onClick={() => onChange(t.id)}
          >
            {t.icon ? <Icon name={t.icon} filled={selected} /> : null}
            <span>{t.label}</span>
            {t.count !== undefined ? <span className="vt-tab-count">{t.count}</span> : null}
          </button>
        )
      })}
    </div>
  )
}
