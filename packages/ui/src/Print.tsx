import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { Button } from './Button.js'
import { formatMoney, formatNumber } from './format.js'
import { useModal } from './modal.js'
import { cx } from './util.js'

export interface PrintPreviewProps {
  /** Heading of the preview: the document and its number, "Invoice No. 2026-0412". */
  title: string
  /** Label of the print button, in the interface language: "Print". */
  printLabel: string
  /** Called by the close button and by Escape. Left out, there is no close button: the preview is a page of its own. */
  onClose?: () => void
  /** Accessible name of the close button, in the interface language. */
  closeLabel?: string
  /** Called in place of the browser's print dialog, to send the document to a printer some other way. */
  onPrint?: () => void
  /** Name the browser gives a saved PDF. Default: the title. */
  fileName?: string
  /** Controls between the title and the print button: the document's language, the paper. */
  actions?: React.ReactNode
  /** One PrintSheet, or several to print together. */
  children: React.ReactNode
}

/** The screen before printing: the document at its real size on a grey ground, with the print button. Only the sheets reach the paper. */
export function PrintPreview({
  title,
  printLabel,
  onClose,
  closeLabel = 'Close',
  onPrint,
  fileName,
  actions,
  children,
}: PrintPreviewProps) {
  const { panel, onKeyDown } = useModal(true, onClose || (() => undefined), !!onClose)
  const titleId = React.useId()

  // While a preview is open, printing the page prints the sheets and nothing else.
  React.useEffect(() => {
    const root = document.documentElement
    root.classList.add('vt-has-preview')
    return () => root.classList.remove('vt-has-preview')
  }, [])

  const print = () => {
    if (onPrint) {
      onPrint()
      return
    }
    // The browser names a saved PDF after the page's title.
    const previous = document.title
    document.title = fileName || title
    window.print()
    document.title = previous
  }

  const node = (
    <div
      ref={panel}
      className="vt-preview"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <header className="vt-preview-bar">
        {onClose ? (
          <Button variant="ghost" icon="close" iconOnly onClick={onClose}>
            {closeLabel}
          </Button>
        ) : null}
        <p id={titleId} className="vt-preview-title">
          {title}
        </p>
        {actions ? <div className="vt-preview-actions">{actions}</div> : null}
        <Button variant="primary" icon="print" onClick={print}>
          {printLabel}
        </Button>
      </header>
      <div className="vt-preview-canvas">{children}</div>
    </div>
  )
  return ReactDOM.createPortal(node, document.body)
}

export interface PrintSheetProps {
  /** a4 (default): invoices, certificates, discharge summaries. a5: prescriptions. receipt: 80 mm receipt paper. */
  paper?: 'a4' | 'a5' | 'receipt'
  /** Names the sheet for screen readers: "Invoice No. 2026-0412". Not printed. */
  label: string
  /** Language of the document when it is not the language of the app: the client's language. */
  lang?: string
  /** The document: a Letterhead, PrintSections, a SignatureBlock; or a Receipt. */
  children: React.ReactNode
  className?: string
}

/** One printed document, at the size of its paper. On screen it is a white sheet; in print it is the page. */
export function PrintSheet({ paper = 'a4', label, lang, children, className }: PrintSheetProps) {
  return (
    <article className={cx('vt-sheet', `vt-sheet-${paper}`, className)} aria-label={label} lang={lang}>
      {children}
    </article>
  )
}

export interface PrintFact {
  /** What the value is: "Date of issue". */
  label: string
  value: React.ReactNode
}

export interface LetterheadProps {
  /** The clinic's own logo: the address of an image. Left out, the clinic's name stands alone. */
  logo?: string
  /** The clinic's name, as registered. */
  clinic: string
  /** Lines under the name: address, phone, tax number. */
  details?: React.ReactNode[]
  /** The document's name, the sheet's h1: "Invoice". */
  title: string
  /** The document's number, with its mark: "No. 2026-0412". */
  number?: string
  /** Facts about the document, under its name: the date of issue, the due date. */
  meta?: PrintFact[]
  className?: string
}

/** The top of an A4 or A5 document: whose it is on the left, what it is on the right. */
export function Letterhead({ logo, clinic, details, title, number, meta, className }: LetterheadProps) {
  return (
    <header className={cx('vt-letterhead', className)}>
      <div className="vt-letterhead-clinic">
        {logo ? <img src={logo} alt="" /> : null}
        <p className="vt-letterhead-name">{clinic}</p>
        {details?.length ? (
          <p className="vt-letterhead-details">
            {details.map((line, i) => (
              <span key={i}>{line}</span>
            ))}
          </p>
        ) : null}
      </div>
      <div className="vt-letterhead-doc">
        <h1>{title}</h1>
        {number ? <p className="vt-letterhead-number">{number}</p> : null}
        {meta?.length ? (
          <dl>
            {meta.map((m) => (
              <div key={m.label}>
                <dt>{m.label}</dt>
                <dd>{m.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </header>
  )
}

export interface PrintSectionProps {
  /** Heading of the section: "Client", "Diagnosis", "Recommendations". */
  title?: string
  /** Sets the children side by side: client and patient, or three short blocks. */
  columns?: 1 | 2 | 3
  /** Lets a long section run over a page break. By default a section moves to the next page whole when it does not fit. */
  breakable?: boolean
  /** A DetailList, a table, or text. Plain text keeps its line breaks. */
  children: React.ReactNode
  className?: string
}

/** A titled part of a printed document. */
export function PrintSection({ title, columns = 1, breakable = false, children, className }: PrintSectionProps) {
  const text = typeof children === 'string'
  return (
    <section className={cx('vt-psec', breakable && 'is-breakable', className)}>
      {title ? <h2>{title}</h2> : null}
      {text ? (
        <p className="vt-psec-text">{children}</p>
      ) : (
        <div className={cx('vt-psec-body', columns > 1 && `vt-psec-cols-${columns}`)}>{children}</div>
      )}
    </section>
  )
}

export interface Signature {
  /** Who signs: "Veterinarian", "Client". */
  label: string
  /** The signer's name, printed beside the line. */
  name?: string
}

export interface SignatureBlockProps {
  signatures: Signature[]
  /** The word under each line, in the document's language: "Signature". */
  signatureLabel: string
  /** Marks the place for the clinic's stamp, in the document's language: "M.Y.", "М.П.", "Stamp". Left out, no place is drawn. */
  stamp?: string
  className?: string
}

/** The lines to sign at the foot of a document, and the place for the clinic's stamp. */
export function SignatureBlock({ signatures, signatureLabel, stamp, className }: SignatureBlockProps) {
  return (
    <div className={cx('vt-signs', className)}>
      {signatures.map((s) => (
        <div key={s.label} className="vt-sign">
          <span className="vt-sign-label">{s.label}</span>
          <span className="vt-sign-row">
            <span className="vt-sign-line" />
            {s.name ? <span className="vt-sign-name">{s.name}</span> : null}
          </span>
          <span className="vt-sign-hint">{signatureLabel}</span>
        </div>
      ))}
      {stamp ? <span className="vt-stamp">{stamp}</span> : null}
    </div>
  )
}

export interface ReceiptLine {
  id: string
  /** The service or product, as on the price list. */
  name: string
  quantity: number
  /** Unit of the quantity, from the glossary: "əd.", "ml". */
  unit?: string
  /** Price of one unit. */
  price: number
  /** What the line comes to. Worked out by the application. */
  amount: number
}

export interface ReceiptAmount {
  id: string
  /** "Subtotal", "Discount", "Total"; "Cash", "Change". */
  label: string
  amount: number
  /** Draws the row large and bold: the total. */
  strong?: boolean
}

export interface ReceiptProps {
  /** The clinic's logo in one ink: the address of an image. */
  logo?: string
  clinic: string
  /** Lines under the name: address, phone, tax number. */
  details?: React.ReactNode[]
  /** The receipt's name and number: "Receipt No. 004218". */
  title: string
  /** Facts above the lines: date and time, cashier, client, patient. */
  meta?: PrintFact[]
  lines: ReceiptLine[]
  /** The rows under the lines, in order. Worked out by the application. */
  totals: ReceiptAmount[]
  /** How it was paid, under the totals: the method and amount, cash received, change. */
  payments?: ReceiptAmount[]
  /** What the receipt must say about itself: "Not a fiscal receipt". */
  note?: React.ReactNode
  /** Closing lines, centred: thanks, the next appointment. */
  footer?: React.ReactNode
  /** Language tag for number formatting. Defaults to the page's `lang`. */
  locale?: string
  className?: string
}

/** A receipt for 80 mm paper: one narrow column in black, read from top to bottom. Goes inside a PrintSheet with paper="receipt". */
export function Receipt({
  logo,
  clinic,
  details,
  title,
  meta,
  lines,
  totals,
  payments,
  note,
  footer,
  locale,
  className,
}: ReceiptProps) {
  const money = (v: number) => formatNumber(v, { decimals: 2, locale })
  const amounts = (rows: ReceiptAmount[]) => (
    <dl className="vt-receipt-rows">
      {rows.map((t) => (
        <div key={t.id} className={cx(t.strong && 'is-strong')}>
          <dt>{t.label}</dt>
          <dd>{formatMoney(t.amount, locale)}</dd>
        </div>
      ))}
    </dl>
  )
  return (
    <div className={cx('vt-receipt', className)}>
      <div className="vt-receipt-head">
        {logo ? <img src={logo} alt="" /> : null}
        <p className="vt-receipt-clinic">{clinic}</p>
        {details ? details.map((line, i) => <p key={i}>{line}</p>) : null}
      </div>
      <h1>{title}</h1>
      {meta?.length ? (
        <dl className="vt-receipt-rows">
          {meta.map((m) => (
            <div key={m.label}>
              <dt>{m.label}</dt>
              <dd>{m.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <ul className="vt-receipt-lines">
        {lines.map((line) => (
          <li key={line.id}>
            <span className="vt-receipt-name">{line.name}</span>
            <span className="vt-receipt-calc">
              <span>
                {formatNumber(line.quantity, { locale })}
                {line.unit ? ` ${line.unit}` : ''} × {money(line.price)}
              </span>
              <span>{money(line.amount)}</span>
            </span>
          </li>
        ))}
      </ul>
      {amounts(totals)}
      {payments?.length ? amounts(payments) : null}
      {note ? <p className="vt-receipt-note">{note}</p> : null}
      {footer ? <div className="vt-receipt-foot">{footer}</div> : null}
    </div>
  )
}
