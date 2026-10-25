import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { Toast } from './Feedback.js'
import { _queue, _subscribe, dismissToast, type QueuedToast } from './toasts.js'
import { cx } from './util.js'

export interface ToasterProps {
  /** Names the corner where toasts appear, for screen readers, in the interface language: "Notifications". */
  label: string
  /** Accessible name of each toast's close button, in the interface language: "Close". */
  closeLabel: string
  /** How many toasts show at once. The rest wait their turn; a warning or a failure goes first. Default 3. */
  max?: number
  className?: string
}

const urgent = (t: QueuedToast) => t.status === 'danger' || t.status === 'warning'
const timeOf = (t: QueuedToast): number | null =>
  t.duration !== undefined
    ? t.duration
    : t.status === 'danger' || t.status === 'warning'
      ? null
      : t.action
        ? 10000
        : 5000

function Item({
  item,
  paused,
  closeLabel,
  onClose,
}: {
  item: QueuedToast
  paused: boolean
  closeLabel: string
  onClose: (id: string) => void
}) {
  const left = React.useRef<number | null>(timeOf(item))
  const turn = React.useRef(item.turn)
  if (turn.current !== item.turn) {
    // replaced by a toast of the same name: its time starts again
    turn.current = item.turn
    left.current = timeOf(item)
  }
  React.useEffect(() => {
    if (left.current === null || paused) return
    const started = Date.now()
    const timer = window.setTimeout(() => dismissToast(item.id), Math.max(0, left.current))
    return () => {
      window.clearTimeout(timer)
      if (left.current !== null) left.current -= Date.now() - started
    }
  }, [paused, item.id, item.turn])
  const close = () => onClose(item.id)
  return (
    <div
      className="vt-toaster-item"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          close()
        }
      }}
    >
      <Toast
        status={item.status}
        title={item.title}
        closeLabel={closeLabel}
        onClose={close}
        action={
          item.action
            ? {
                label: item.action.label,
                onClick: () => {
                  item.action?.onClick()
                  close()
                },
              }
            : undefined
        }
      >
        {item.body}
      </Toast>
    </div>
  )
}

/** Whether an element has focus that came from the keyboard. A button pressed with the pointer does not count. */
function keyboardFocus(el: Element | null): boolean {
  if (!el || el === document.body) return false
  try {
    return el.matches(':focus-visible')
  } catch (_e) {
    return true
  }
}

/**
 * The corner of the screen where toasts appear, and the queue behind it. Put one on the page, beside the AppShell;
 * then call `Vetora.toast()` from anywhere.
 */
export function Toaster({ label, closeLabel, max = 3, className }: ToasterProps) {
  const queue = React.useSyncExternalStore(_subscribe, _queue, _queue)
  const region = React.useRef<HTMLDivElement>(null)
  const cameFrom = React.useRef<HTMLElement | null>(null)
  const [hover, setHover] = React.useState(false)
  const [inside, setInside] = React.useState(false)
  const [hidden, setHidden] = React.useState(false)
  React.useEffect(() => {
    const read = () => setHidden(document.visibilityState === 'hidden')
    read()
    document.addEventListener('visibilitychange', read)
    return () => document.removeEventListener('visibilitychange', read)
  }, [])
  // Three show at once. A warning or a failure does not wait behind confirmations: it takes the place of the newest
  // one showing, which comes back when there is room again.
  const first = queue.filter(urgent).slice(0, max)
  const rest = queue.filter((t) => !urgent(t)).slice(0, max - first.length)
  const shown = queue.filter((t) => first.indexOf(t) >= 0 || rest.indexOf(t) >= 0)
  const focusInside = () => {
    const el = region.current
    return !!el && el.contains(document.activeElement) && keyboardFocus(document.activeElement)
  }
  // A toast that leaves takes the pointer or the focus that was on it without telling anyone: read both again.
  React.useEffect(() => {
    if (queue.length === 0) setHover(false)
    setInside(focusInside())
  }, [queue])
  // Closing a toast must not drop focus on the floor. From the keyboard it goes to the next toast, or back to where it
  // was before; after a press with the pointer it goes back, and the clock of the other toasts keeps running.
  const onClose = (id: string) => {
    const el = region.current
    const active = document.activeElement
    const had = !!el && el.contains(active)
    const byKeyboard = had && keyboardFocus(active)
    dismissToast(id)
    if (!had) return
    window.setTimeout(() => {
      const next = byKeyboard && region.current ? region.current.querySelector<HTMLElement>('button') : null
      if (next) next.focus()
      else if (cameFrom.current && document.contains(cameFrom.current)) cameFrom.current.focus()
      setInside(focusInside())
    }, 0)
  }
  const node = (
    <div
      ref={region}
      className={cx('vt-toaster', className)}
      role="region"
      aria-label={label}
      aria-live="polite"
      aria-relevant="additions text"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={(e) => {
        if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)))
          cameFrom.current = e.relatedTarget instanceof HTMLElement ? e.relatedTarget : null
        setInside(focusInside())
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setInside(false)
      }}
    >
      {shown.map((item) => (
        <Item key={item.id} item={item} paused={hover || inside || hidden} closeLabel={closeLabel} onClose={onClose} />
      ))}
    </div>
  )
  return ReactDOM.createPortal(node, document.body)
}
