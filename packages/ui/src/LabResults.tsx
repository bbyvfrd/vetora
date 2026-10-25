import { Badge } from './Badge.js'
import { formatNumber } from './format.js'
import { cx } from './util.js'

export interface LabResult {
  id: string
  /** The test, as the laboratory names it: "Glucose", "ALT". */
  name: string
  value: number
  unit?: string
  /** Lower and upper end of the reference range for this species. Either may be missing. */
  low?: number
  high?: number
  /** The result of the same test last time. */
  previous?: number
  /** Decimals to show for this test. Left out, trailing zeros are dropped. */
  decimals?: number
}

export interface LabResultsLabels {
  /** Column headings, in the interface language. */
  test: string
  result: string
  range: string
  /** Heading of the previous-result column. Leave out to hide the column. */
  previous?: string
  /** The words for a result above and below the range: "High", "Low". */
  high: string
  low: string
}

export interface LabResultsProps {
  /** Names the table for screen readers: "Biochemistry, 12 October 2026". Not shown. */
  caption: string
  results: LabResult[]
  labels: LabResultsLabels
  /** Language tag for number formatting. Defaults to the page's `lang`. */
  locale?: string
  /** compact (default) 36px rows; default 44px rows. */
  density?: 'default' | 'compact'
  className?: string
}

/** Laboratory results against their reference ranges. Only what is out of range is flagged. */
export function LabResults({ caption, results, labels, locale, density = 'compact', className }: LabResultsProps) {
  const num = (r: LabResult, v: number) => formatNumber(v, { decimals: r.decimals, locale })
  return (
    <div className={cx('vt-table-wrap', className)}>
      <table className={cx('vt-table', `vt-table-${density}`, 'vt-lab')}>
        <caption className="vt-sr">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{labels.test}</th>
            <th scope="col" className="is-numeric">
              {labels.result}
            </th>
            <th scope="col" aria-hidden="true" />
            <th scope="col">{labels.range}</th>
            {labels.previous ? (
              <th scope="col" className="is-numeric">
                {labels.previous}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {results.map((r) => {
            const flag =
              r.high !== undefined && r.value > r.high ? 'high' : r.low !== undefined && r.value < r.low ? 'low' : null
            const both = r.low !== undefined && r.high !== undefined && r.high > r.low
            // The track runs half a range past each end, so the reference range is always its middle half.
            const at = both
              ? Math.min(
                  100,
                  Math.max(0, ((r.value - (r.low as number)) / ((r.high as number) - (r.low as number))) * 50 + 25),
                )
              : 0
            const range = both
              ? `${num(r, r.low as number)}–${num(r, r.high as number)}`
              : r.high !== undefined
                ? `< ${num(r, r.high)}`
                : r.low !== undefined
                  ? `> ${num(r, r.low)}`
                  : ''
            return (
              <tr key={r.id} className={cx(flag && 'is-flagged')}>
                <th scope="row">{r.name}</th>
                <td className="is-numeric">
                  <span className="vt-lab-value">{num(r, r.value)}</span>
                  {r.unit ? <span className="vt-lab-unit"> {r.unit}</span> : null}
                </td>
                <td className="vt-lab-flag">
                  {flag ? (
                    <Badge status="danger" icon={flag === 'high' ? 'arrow_upward' : 'arrow_downward'}>
                      {labels[flag]}
                    </Badge>
                  ) : null}
                </td>
                <td>
                  <span className="vt-lab-range">{range}</span>
                  {both ? (
                    <span className="vt-range" aria-hidden="true">
                      <span className="vt-range-band" />
                      <span className={cx('vt-range-dot', flag && 'is-out')} style={{ left: `${at}%` }} />
                    </span>
                  ) : null}
                </td>
                {labels.previous ? (
                  <td className="is-numeric vt-lab-prev">{r.previous !== undefined ? num(r, r.previous) : ''}</td>
                ) : null}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
