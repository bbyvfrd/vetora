import { cx } from './util.js'

export interface SkeletonProps {
  /** text: lines of body text (default). block: a rectangle such as a card or chart. circle: an avatar. */
  variant?: 'text' | 'block' | 'circle'
  /** Number of text lines. The last is shorter. Default 1. */
  lines?: number
  /** CSS width: a number is pixels. Defaults to the full width (circle: 40px). */
  width?: number | string
  /** CSS height of a block or circle: a number is pixels. Defaults to 80px (circle: its width). */
  height?: number | string
  className?: string
}

/** A grey placeholder in the shape of content that is still loading. Hidden from screen readers: mark the region `aria-busy`. */
export function Skeleton({ variant = 'text', lines = 1, width, height, className }: SkeletonProps) {
  if (variant === 'text') {
    return (
      <span className={cx('vt-skel-text', className)} style={{ width }} aria-hidden="true">
        {Array.from({ length: Math.max(1, lines) }, (_, i) => (
          <span key={i} className="vt-skel" style={lines > 1 && i === lines - 1 ? { width: '60%' } : undefined} />
        ))}
      </span>
    )
  }
  const w = width !== undefined ? width : variant === 'circle' ? 40 : undefined
  const h = height !== undefined ? height : variant === 'circle' ? w : 80
  return (
    <span
      className={cx('vt-skel', `vt-skel-${variant}`, className)}
      style={{ width: w, height: h }}
      aria-hidden="true"
    />
  )
}
