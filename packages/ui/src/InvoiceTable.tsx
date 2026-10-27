import * as React from 'react'
import { formatNumber, parseNumber } from './format.js'
import { Icon } from './Icon.js'
import { formatMinorUnits, formatMinorUnitsPlain } from './money.js'
import { cx } from './util.js'

export interface InvoiceLine {
  id: string
  /** The service or product, as on the price list. */
  name: string
  /** A second line: who performed it, the batch, a note. */
  detail?: string
  quantity: number
  /** Unit of the quantity, from the glossary: "əd.", "ml". */
  unit?: string
  /** Price of one unit, in whole minor units of the table's `currency` (IN-4): 2500 is 25,00 ₼. */
  price: number | bigint
  /** Discount on this line, in percent. */
  discount?: number
  /** What the line comes to, in minor units. Worked out by the application, not by the table. */
  amount: number | bigint
}

export interface InvoiceTotal {
  id: string
  /** "Subtotal", "Discount", "VAT 18%", "Total", "Paid", "Balance due". */
  label: string
  /** In whole minor units of the table's `currency`. */
  amount: number | bigint
  /** Draws the row large and bold: the total, and the balance due. */
  strong?: boolean
}

export interface InvoiceLabels {
  /** Column headings, in the interface language. Put the currency in the heading: "Price, ₼". */
  item: string
  quantity: string
  price: string
  /** Heading of the discount column. Leave out to hide the column. */
  discount?: string
  amount: string
  /** Name of the remove button, in the interface language: "Remove". The line's name is added for screen readers. */
  remove?: string
}

export interface InvoiceTableProps {
  /** Names the table for screen readers: "Invoice 2026-0412". Not shown. */
  caption: string
  lines: InvoiceLine[]
  /** The rows under the lines, in order. Worked out by the application. */
  totals: InvoiceTotal[]
  /** The currency every amount is in, as a code: "AZN". Amounts are shown through the money wrapper (`money.ts`). */
  currency: string
  labels: InvoiceLabels
  /** Language tag for number formatting. Defaults to the page's `lang`. */
  locale?: string
  /** Makes the quantity editable. Called with the line id and the new quantity. */
  onQuantityChange?: (id: string, quantity: number) => void
  /** Adds a remove button to each line. */
  onRemove?: (id: string) => void
  /** Shown when there are no lines: "No services added yet". */
  emptyText?: React.ReactNode
  className?: string
}

function Quantity({
  line,
  label,
  locale,
  onChange,
}: {
  line: InvoiceLine
  label: string
  locale?: string
  onChange: (id: string, quantity: number) => void
}) {
  const shown = formatNumber(line.quantity, { locale })
  const [text, setText] = React.useState(shown)
  const [bad, setBad] = React.useState(false)
  React.useEffect(() => {
    setText(shown)
    setBad(false)
  }, [shown])
  const commit = () => {
    const n = parseNumber(text)
    if (n === null || n <= 0) {
      setBad(true)
      return
    }
    setBad(false)
    if (n !== line.quantity) onChange(line.id, n)
    else setText(shown)
  }
  return (
    <span className={cx('vt-input', 'vt-input-sm', 'vt-qty', bad && 'is-invalid')}>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label={`${label}: ${line.name}`}
        aria-invalid={bad ? true : undefined}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setBad(false)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
      />
      {line.unit ? <span className="vt-input-suffix">{line.unit}</span> : null}
    </span>
  )
}

/** The lines of an invoice with their totals. Shows them, or lets the quantity be changed and lines removed. */
export function InvoiceTable({
  caption,
  lines,
  totals,
  currency,
  labels,
  locale,
  onQuantityChange,
  onRemove,
  emptyText,
  className,
}: InvoiceTableProps) {
  const money = (v: number | bigint) => formatMinorUnitsPlain(v, currency, locale)
  const columns = 4 + (labels.discount ? 1 : 0) + (onRemove ? 1 : 0)
  return (
    <div className={cx('vt-table-wrap', className)}>
      <table className="vt-table vt-invoice">
        <caption className="vt-sr">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{labels.item}</th>
            <th scope="col" className="is-numeric">
              {labels.quantity}
            </th>
            <th scope="col" className="is-numeric">
              {labels.price}
            </th>
            {labels.discount ? (
              <th scope="col" className="is-numeric">
                {labels.discount}
              </th>
            ) : null}
            <th scope="col" className="is-numeric">
              {labels.amount}
            </th>
            {onRemove ? <th scope="col" className="vt-invoice-remove" aria-hidden="true" /> : null}
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr className="vt-table-empty">
              <td colSpan={columns}>{emptyText}</td>
            </tr>
          ) : (
            lines.map((line) => (
              <tr key={line.id}>
                <th scope="row">
                  <span className="vt-invoice-name">{line.name}</span>
                  {line.detail ? <span className="vt-invoice-detail">{line.detail}</span> : null}
                </th>
                <td className="is-numeric">
                  {onQuantityChange ? (
                    <Quantity line={line} label={labels.quantity} locale={locale} onChange={onQuantityChange} />
                  ) : (
                    <>
                      {formatNumber(line.quantity, { locale })}
                      {line.unit ? <span className="vt-lab-unit"> {line.unit}</span> : null}
                    </>
                  )}
                </td>
                <td className="is-numeric">{money(line.price)}</td>
                {labels.discount ? (
                  <td className="is-numeric">{line.discount ? `${formatNumber(line.discount, { locale })}%` : ''}</td>
                ) : null}
                <td className="is-numeric vt-invoice-amount">{money(line.amount)}</td>
                {onRemove ? (
                  <td className="vt-invoice-remove">
                    <button
                      type="button"
                      className="vt-input-btn"
                      aria-label={`${labels.remove || ''}: ${line.name}`}
                      title={labels.remove}
                      onClick={() => onRemove(line.id)}
                    >
                      <Icon name="delete" />
                    </button>
                  </td>
                ) : null}
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          {totals.map((t) => (
            <tr key={t.id} className={cx(t.strong && 'is-strong')}>
              <th scope="row" colSpan={columns - 1 - (onRemove ? 1 : 0)}>
                {t.label}
              </th>
              <td className="is-numeric">{formatMinorUnits(t.amount, currency, locale)}</td>
              {onRemove ? <td /> : null}
            </tr>
          ))}
        </tfoot>
      </table>
    </div>
  )
}
