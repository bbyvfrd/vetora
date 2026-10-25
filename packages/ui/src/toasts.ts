import type * as React from 'react'

export interface ToastOptions {
  /** What just happened, from Messages: "Appointment cancelled". */
  title: string
  /** success (default), info, warning or danger. */
  status?: 'info' | 'success' | 'warning' | 'danger'
  /** A line of detail under the title. Rarely needed. */
  body?: React.ReactNode
  /** One follow-up, usually "Undo". Pressing it also closes the toast. */
  action?: { label: string; onClick: () => void }
  /**
   * How long it stays, in milliseconds; `null` keeps it until it is closed.
   * Default: 5 seconds, 10 with an action, and until closed for a warning or a failure.
   */
  duration?: number | null
  /** A name for this toast. Showing another with the same name replaces it, so "Saved" pressed five times is one toast. */
  id?: string
}

/** A toast in the queue. Internal. */
export interface QueuedToast extends ToastOptions {
  id: string
  /** Changes when a toast is replaced, so its time starts again. */
  turn: number
}

let queue: QueuedToast[] = []
let count = 0
const listeners = new Set<() => void>()
const emit = () => {
  for (const l of listeners) l()
}

/** Internal: the Toaster listens here. */
export function _subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
/** Internal: the toasts waiting and showing, oldest first. */
export function _queue(): QueuedToast[] {
  return queue
}

/**
 * Shows a toast, from anywhere: `Vetora.toast({ title: 'Appointment cancelled' })`. A `Toaster` must be on the page.
 * Returns the toast's id, for `dismissToast`.
 */
export function toast(options: ToastOptions): string {
  count += 1
  const id = options.id || `toast-${count}`
  const next: QueuedToast = { ...options, id, turn: count }
  queue = queue.some((t) => t.id === id) ? queue.map((t) => (t.id === id ? next : t)) : [...queue, next]
  emit()
  return id
}

/** Closes one toast by its id, or every toast when no id is given: on leaving the page they belong to. */
export function dismissToast(id?: string): void {
  const next = id === undefined ? [] : queue.filter((t) => t.id !== id)
  if (next.length === queue.length) return
  queue = next
  emit()
}
