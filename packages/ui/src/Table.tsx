import type * as React from 'react'
import { Icon } from './Icon.js'
import { cx } from './util.js'

export interface TableColumn<Row = any> {
  /** Field of the row to show, and the id used for sorting. */
  key: string
  /** Column heading. Sentence case, no all-caps. */
  header: React.ReactNode
  /** Numbers: right-aligned with tabular figures (weights, doses, prices, times). */
  numeric?: boolean
  /** CSS width, e.g. "30%" or 120. */
  width?: string | number
  /** Heading becomes a sort button. */
  sortable?: boolean
  /** Custom cell content: a Badge, a link, two lines of text. Defaults to row[key]. */
  render?: (row: Row) => React.ReactNode
}

export interface TableSort {
  key: string
  direction: 'asc' | 'desc'
}

export interface TableProps<Row = any> {
  /** Names the table for screen readers. Not shown. */
  caption: string
  columns: TableColumn<Row>[]
  /** Already filtered, sorted and paged by the consumer. */
  rows: Row[]
  /** Stable id of a row. */
  rowKey: (row: Row) => string
  /** default 44px rows, compact 36px rows. */
  density?: 'default' | 'compact'
  /** Current sort, to mark the heading. Sorting itself is done by the consumer. */
  sort?: TableSort
  /** Called with the column key when a sortable heading is pressed. */
  onSort?: (key: string) => void
  /** Key of the selected row, shown on primary-subtle. */
  selectedKey?: string
  /** Makes rows clickable and keyboard-focusable. */
  onRowClick?: (row: Row) => void
  /** Shown in place of rows when there are none. */
  emptyText?: React.ReactNode
  className?: string
}

/** A data table: sortable headings, hover and selected rows, right-aligned numbers. */
export function Table<Row = any>({
  caption,
  columns,
  rows,
  rowKey,
  density = 'default',
  sort,
  onSort,
  selectedKey,
  onRowClick,
  emptyText,
  className,
}: TableProps<Row>) {
  return (
    <div className={cx('vt-table-wrap', className)}>
      <table className={cx('vt-table', `vt-table-${density}`)}>
        <caption className="vt-sr">{caption}</caption>
        <thead>
          <tr>
            {columns.map((col) => {
              const sorted = sort && sort.key === col.key ? sort.direction : undefined
              return (
                <th
                  key={col.key}
                  scope="col"
                  className={cx(col.numeric && 'is-numeric')}
                  style={col.width !== undefined ? { width: col.width } : undefined}
                  aria-sort={
                    col.sortable
                      ? sorted === 'asc'
                        ? 'ascending'
                        : sorted === 'desc'
                          ? 'descending'
                          : 'none'
                      : undefined
                  }
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      className={cx('vt-th-sort', sorted && 'is-sorted')}
                      onClick={() => onSort?.(col.key)}
                    >
                      <span>{col.header}</span>
                      <Icon
                        name={sorted === 'asc' ? 'arrow_upward' : sorted === 'desc' ? 'arrow_downward' : 'unfold_more'}
                        size="sm"
                      />
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="vt-table-empty">
              <td colSpan={columns.length}>{emptyText}</td>
            </tr>
          ) : (
            rows.map((row) => {
              const key = rowKey(row)
              const selected = key === selectedKey
              return (
                <tr
                  key={key}
                  className={cx(onRowClick && 'is-clickable', selected && 'is-selected')}
                  aria-selected={selectedKey !== undefined ? selected : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            onRowClick(row)
                          }
                        }
                      : undefined
                  }
                >
                  {columns.map((col) => (
                    <td key={col.key} className={cx(col.numeric && 'is-numeric')}>
                      {col.render ? col.render(row) : (row as any)[col.key]}
                    </td>
                  ))}
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}
