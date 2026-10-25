import * as React from 'react'
import { cx } from './util.js'

export interface TooltipProps {
  /** The hint: a few words, no punctuation. For an icon-only button, its name. */
  label: string
  /** The element the tooltip describes. Must be focusable (a button, a link, a field). */
  children: React.ReactElement
  /** Side of the element the tooltip opens on. */
  placement?: 'top' | 'bottom' | 'start' | 'end'
  /** Milliseconds of hover before it opens. Focus opens it at once. */
  delay?: number
  /** Open on first render (for documentation and tests). */
  defaultOpen?: boolean
}

/** A short hint shown on hover and on keyboard focus. Never the only place a piece of information lives. */
export function Tooltip({ label, children, placement = 'top', delay = 400, defaultOpen = false }: TooltipProps) {
  const [open, setOpen] = React.useState(defaultOpen)
  const timer = React.useRef<number | undefined>(undefined)
  const id = React.useId()
  const show = (wait: number) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOpen(true), wait)
  }
  const hide = () => {
    window.clearTimeout(timer.current)
    setOpen(false)
  }
  React.useEffect(() => () => window.clearTimeout(timer.current), [])
  // Keep the bubble inside the window: slide it sideways when the element sits near an edge.
  const bubble = React.useRef<HTMLSpanElement>(null)
  React.useLayoutEffect(() => {
    const el = bubble.current
    if (!open || !el) return
    el.style.setProperty('--vt-tip-shift', '0px')
    const box = el.getBoundingClientRect()
    const edge = 8
    const max = document.documentElement.clientWidth - edge
    let shift = 0
    if (box.left < edge) shift = edge - box.left
    else if (box.right > max) shift = max - box.right
    el.style.setProperty('--vt-tip-shift', `${Math.round(shift)}px`)
  }, [open, label, placement])
  return (
    <span
      className="vt-tip"
      onMouseEnter={() => show(delay)}
      onMouseLeave={hide}
      onFocus={() => show(0)}
      onBlur={hide}
      onKeyDown={(e) => {
        if (e.key === 'Escape') hide()
      }}
    >
      {React.cloneElement(children as React.ReactElement<React.AriaAttributes>, { 'aria-describedby': id })}
      <span ref={bubble} id={id} role="tooltip" className={cx('vt-tip-bubble', `is-${placement}`, open && 'is-open')}>
        {label}
      </span>
    </span>
  )
}
