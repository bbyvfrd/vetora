import * as React from 'react'

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * What every modal surface does: takes focus when it opens, keeps Tab inside, closes on Escape,
 * stops the page behind from scrolling and gives focus back when it closes. Internal.
 */
export function useModal(open: boolean, onClose: () => void, dismissible: boolean) {
  const panel = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const el = panel.current
    // Take focus only when the page itself has it, so a modal opened in a background frame does not pull focus away.
    const moved = !!el && document.hasFocus()
    if (el && moved) {
      const first = el.querySelector<HTMLElement>('[autofocus]') || el
      first.focus({ preventScroll: true })
    }
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
      if (moved && previous?.focus) previous.focus({ preventScroll: true })
    }
  }, [open])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && dismissible) {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !panel.current) return
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (items.length === 0) {
      e.preventDefault()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === panel.current)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return { panel, onKeyDown }
}
