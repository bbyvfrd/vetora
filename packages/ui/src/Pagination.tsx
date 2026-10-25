import type * as React from 'react'
import { Icon } from './Icon.js'
import { cx } from './util.js'

export interface PaginationProps {
  /** The current page, counting from 1. */
  page: number
  /** How many pages there are. */
  pageCount: number
  /** Called with the page that was asked for. */
  onChange: (page: number) => void
  /** Accessible name of the navigation, in the interface language: "Pages". */
  label: string
  /** Accessible name of the previous button: "Previous page". */
  previousLabel: string
  /** Accessible name of the next button: "Next page". */
  nextLabel: string
  /** Accessible name of a page button. Default: the number alone. Pass `(n) => "Page " + n`, translated. */
  pageLabel?: (page: number) => string
  /** Text on the left saying what is shown: "1–20 of 214". */
  summary?: React.ReactNode
  className?: string
}

/** The pages to show: first, last, the current one and its neighbours, with gaps marked 0. */
function pages(page: number, count: number): number[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1)
  const out = [1]
  let from = Math.max(2, Math.min(page - 1, count - 4))
  let to = Math.min(count - 1, Math.max(page + 1, 5))
  // A gap that would hide a single page shows that page instead.
  if (from === 3) from = 2
  if (to === count - 2) to = count - 1
  if (from > 2) out.push(0)
  for (let i = from; i <= to; i++) out.push(i)
  if (to < count - 1) out.push(0)
  out.push(count)
  return out
}

/** Moves through the pages of a long list. */
export function Pagination({
  page,
  pageCount,
  onChange,
  label,
  previousLabel,
  nextLabel,
  pageLabel,
  summary,
  className,
}: PaginationProps) {
  if (pageCount <= 1 && !summary) return null
  const go = (p: number) => {
    if (p >= 1 && p <= pageCount && p !== page) onChange(p)
  }
  return (
    <nav className={cx('vt-pager', className)} aria-label={label}>
      {summary ? <p className="vt-pager-summary">{summary}</p> : null}
      {pageCount > 1 ? (
        <ul>
          <li>
            <button
              type="button"
              className="vt-pager-btn"
              aria-label={previousLabel}
              disabled={page <= 1}
              onClick={() => go(page - 1)}
            >
              <Icon name="chevron_left" />
            </button>
          </li>
          {pages(page, pageCount).map((p, i) =>
            p === 0 ? (
              <li key={`gap${i}`} className="vt-pager-gap" aria-hidden="true">
                …
              </li>
            ) : (
              <li key={p}>
                <button
                  type="button"
                  className={cx('vt-pager-btn', p === page && 'is-current')}
                  aria-label={pageLabel ? pageLabel(p) : undefined}
                  aria-current={p === page ? 'page' : undefined}
                  onClick={() => go(p)}
                >
                  {p}
                </button>
              </li>
            ),
          )}
          <li>
            <button
              type="button"
              className="vt-pager-btn"
              aria-label={nextLabel}
              disabled={page >= pageCount}
              onClick={() => go(page + 1)}
            >
              <Icon name="chevron_right" />
            </button>
          </li>
        </ul>
      ) : null}
    </nav>
  )
}
