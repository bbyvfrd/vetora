import * as React from 'react'
import { Icon } from './Icon.js'
import type { IconName } from './icons.js'
import { cx } from './util.js'

export interface MenuItem {
  id: string
  label: string
  icon?: IconName
  /** Destructive action: shown in danger and placed last. */
  danger?: boolean
  disabled?: boolean
  /** Draws a divider above this item. */
  separatorBefore?: boolean
}

export interface MenuProps {
  /** The element that opens the menu: a Button, usually icon-only "more_vert" or with iconEnd "keyboard_arrow_down". */
  trigger: React.ReactElement
  items: MenuItem[]
  /** Called with the item id. The menu closes itself. */
  onSelect: (id: string) => void
  /** Which edge of the trigger the menu lines up with. */
  align?: 'start' | 'end'
  /** Open on first render (for documentation and tests). */
  defaultOpen?: boolean
  className?: string
}

/** A list of actions that opens from a button. Arrow keys move, Enter chooses, Escape closes. */
export function Menu({ trigger, items, onSelect, align = 'start', defaultOpen = false, className }: MenuProps) {
  const [open, setOpen] = React.useState(defaultOpen)
  const wrap = React.useRef<HTMLSpanElement>(null)
  const list = React.useRef<HTMLDivElement>(null)
  const focusTrigger = () => {
    const t = wrap.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]')
    if (t) t.focus()
  }
  const enabledItems = () =>
    list.current ? Array.from(list.current.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')) : []

  React.useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const openAndFocus = () => {
    setOpen(true)
    window.setTimeout(() => {
      const first = enabledItems()[0]
      if (first) first.focus()
    }, 0)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const els = enabledItems()
    const i = els.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown') els[(i + 1) % els.length]?.focus()
    else if (e.key === 'ArrowUp') els[(i - 1 + els.length) % els.length]?.focus()
    else if (e.key === 'Home') els[0]?.focus()
    else if (e.key === 'End') els[els.length - 1]?.focus()
    else if (e.key === 'Escape') {
      setOpen(false)
      focusTrigger()
    } else if (e.key === 'Tab') {
      setOpen(false)
      return
    } else return
    e.preventDefault()
  }

  // React 19 types an element's props as unknown: the trigger is read as the button-like element it is.
  const button = trigger as React.ReactElement<React.AriaAttributes & { onClick?: (e: React.MouseEvent) => void }>
  const triggerEl = React.cloneElement(button, {
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    onClick: (e: React.MouseEvent) => {
      if (button.props.onClick) button.props.onClick(e)
      if (open) setOpen(false)
      else openAndFocus()
    },
  })

  return (
    <span ref={wrap} className={cx('vt-menu', className)}>
      {triggerEl}
      {open ? (
        <div ref={list} className={cx('vt-menu-list', `is-${align}`)} role="menu" onKeyDown={onKeyDown}>
          {items.map((it) => (
            <React.Fragment key={it.id}>
              {it.separatorBefore ? <div className="vt-menu-sep" role="separator" /> : null}
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={it.disabled}
                className={cx('vt-menu-item', it.danger && 'is-danger')}
                onClick={() => {
                  setOpen(false)
                  focusTrigger()
                  onSelect(it.id)
                }}
              >
                {it.icon ? <Icon name={it.icon} /> : null}
                <span>{it.label}</span>
              </button>
            </React.Fragment>
          ))}
        </div>
      ) : null}
    </span>
  )
}
