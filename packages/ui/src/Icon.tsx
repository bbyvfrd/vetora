import { ICONS, type IconName } from './icons.js'
import { cx } from './util.js'

export interface IconProps {
  /** Icon name from the Vetora set (assets/Icons). */
  name: IconName
  /** Filled form: selected states and status. Icons without a filled form render the outline. */
  filled?: boolean
  /** sm 16px, md 20px (default), lg 24px, xl 40px. */
  size?: 'sm' | 'md' | 'lg' | 'xl'
  /** Accessible name. Omit when the icon sits beside a visible label: it is then hidden from screen readers. */
  label?: string
  className?: string
}

/** One icon from the Vetora set, drawn in the current text colour. */
export function Icon({ name, filled = false, size = 'md', label, className }: IconProps) {
  const icon = ICONS[name]
  if (!icon) return null
  return (
    <svg
      className={cx('vt-icon', `vt-icon-${size}`, className)}
      viewBox="0 -960 960 960"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path fill="currentColor" d={(filled && icon.f) || icon.o} />
    </svg>
  )
}
