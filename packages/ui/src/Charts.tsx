import * as React from 'react'
import { Button } from './Button.js'
import { formatNumber } from './format.js'
import { Icon } from './Icon.js'
import { Table } from './Table.js'
import { cx } from './util.js'

/** A slot of the chart palette: `chart-1` to `chart-5`, or the grey of "Other" and of anything shown for comparison. */
export type ChartColor = 1 | 2 | 3 | 4 | 5 | 'other'

export interface ChartSeries {
  id: string
  /** Name in the legend, the tooltip and the table: "Vaccination", "Last month". */
  label: string
  /** One value for each category, in order. `null` where there is none. Charts start at zero: a value below zero has no bar and sits on the baseline of a line; the tooltip and the table still give it. */
  values: Array<number | null>
  /** Slot of the palette. Default: the position of the series, first to fifth; a sixth and later take the grey of "Other". Give it so a thing keeps its colour when the list of series changes. */
  color?: ChartColor
}

export interface ChartLabels {
  /** The button that shows the chart: "Chart". */
  chart: string
  /** The button that shows the same numbers as a table: "Table". */
  table: string
  /** Heading of the first column of the table: what the categories are, "Day". */
  category: string
  /** Adds a total to the tooltip and the table of a stacked chart: "Total". */
  total?: string
}

/** What every chart takes. */
export interface ChartCommonProps {
  /** What the chart shows. The accessible name of the chart and the caption of its table. Not shown: the card's title says it. */
  caption: string
  /** The steps along the bottom, in order: days, weeks, months. */
  categories: string[]
  /** One to five series. */
  series: ChartSeries[]
  /** Height of the plot with its axis, in pixels. Default 240. */
  height?: number
  /** Unit of the values, set at the top of the value axis: "₼". */
  unit?: string
  /** Writes a value. Default `Vetora.formatNumber`. */
  format?: (value: number) => string
  /** Language tag for the default number format. Defaults to the page's `lang`. */
  locale?: string
  /** The words of the chart, in the interface language. */
  labels: ChartLabels
  /** Which view shows first. Default the chart. */
  defaultView?: 'chart' | 'table'
  /** New numbers are on their way: the chart stays as it is, dimmed. */
  busy?: boolean
  /** Shown in place of the plot when there are no values: "No visits in this period". */
  emptyText?: string
  className?: string
}

const fillOf = (c: ChartColor) => (c === 'other' ? 'var(--chart-other)' : `var(--chart-${c})`)
const slotOf = (s: ChartSeries, i: number): ChartColor => s.color || (i < 5 ? ((i + 1) as ChartColor) : 'other')
const safe = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
const has = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)
/** The value as it is, for sums. */
const num = (v: number | null | undefined) => (has(v) ? v : 0)

/** Round steps for the value axis, from zero to at least `max`. */
function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1]
  const raw = max / count
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / magnitude
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * magnitude
  const ticks = [0]
  while (ticks[ticks.length - 1] < max - step * 1e-9) ticks.push(+(ticks[ticks.length - 1] + step).toFixed(10))
  return ticks
}

let canvas: CanvasRenderingContext2D | null | undefined
/** Width of a 12px label. Measured where the browser can, estimated where it cannot. */
function textWidth(text: string, weight = 400): number {
  if (canvas === undefined) {
    try {
      canvas = document.createElement('canvas').getContext('2d')
    } catch (_e) {
      canvas = null
    }
  }
  if (canvas) {
    canvas.font = `${weight} 12px Roboto, system-ui, sans-serif`
    return canvas.measureText(text).width
  }
  return text.length * 6.9
}

/** Width of an element, kept up to date as it is resized; and a tick that turns when the fonts arrive, so labels are measured again. */
function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = React.useState(0)
  const [, tick] = React.useState(0)
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => setWidth(el.getBoundingClientRect().width)
    read()
    let observer: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(read)
      observer.observe(el)
    }
    const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts
    let alive = true
    if (fonts) fonts.ready.then(() => alive && tick((n) => n + 1))
    return () => {
      alive = false
      if (observer) observer.disconnect()
    }
  }, [])
  return width
}

function useUid(): string {
  return `vtc${React.useId().replace(/[^a-zA-Z0-9]/g, '')}`
}

/** Hatching that stands in for colour on paper and in forced colours: two directions, two densities, none on the first slot. */
function Textures({ uid }: { uid: string }) {
  const one = (n: number, angle: number, gap: number) => (
    <pattern
      key={n}
      id={`${uid}-t${n}`}
      patternUnits="userSpaceOnUse"
      width={gap}
      height={gap}
      patternTransform={`rotate(${angle})`}
    >
      <line x1="0" y1="0" x2="0" y2={gap} stroke="var(--surface)" strokeWidth="1.5" />
    </pattern>
  )
  return <defs>{[one(2, 45, 6), one(3, 135, 6), one(4, 45, 3.5), one(5, 135, 3.5)]}</defs>
}
const textureOf = (uid: string, c: ChartColor) => (c === 'other' || c === 1 ? undefined : `url(#${uid}-t${c})`)

function Legend({ series, uid, shape }: { series: ChartSeries[]; uid: string; shape: 'rect' | 'line' }) {
  return (
    <ul className="vt-chart-legend">
      {series.map((s, i) => {
        const c = slotOf(s, i)
        return (
          <li key={s.id}>
            {shape === 'rect' ? (
              <svg className="vt-chart-key" width="12" height="12" aria-hidden="true">
                <rect width="12" height="12" rx="2" fill={fillOf(c)} />
                {textureOf(uid, c) ? (
                  <rect className="vt-chart-texture" width="12" height="12" rx="2" fill={textureOf(uid, c)} />
                ) : null}
              </svg>
            ) : (
              <svg className="vt-chart-key" width="16" height="12" aria-hidden="true">
                <line x1="1" y1="6" x2="15" y2="6" stroke={fillOf(c)} strokeWidth="2" strokeLinecap="round" />
              </svg>
            )}
            {s.label}
          </li>
        )
      })}
    </ul>
  )
}

interface FrameProps {
  base: ChartCommonProps
  uid: string
  shape: 'rect' | 'line'
  total: boolean
  children: (view: { fmt: (v: number) => string }) => React.ReactNode
}

/** What every chart has around its plot: the legend, the switch to a table, the table itself, the empty state. */
function Frame({ base, uid, shape, total, children }: FrameProps) {
  const {
    caption,
    categories,
    series,
    height = 240,
    format,
    locale,
    labels,
    defaultView = 'chart',
    emptyText,
    className,
  } = base
  const [view, setView] = React.useState(defaultView)
  const fmt = format || ((v: number) => formatNumber(v, { locale }))
  const empty = categories.length === 0 || !series.some((s) => s.values.some(has))
  const rows = categories.map((category, i) => ({ i, category }))
  const showTotal = total && !!labels.total && series.length > 1
  return (
    <figure className={cx('vt-chart', className)}>
      <figcaption className="vt-sr">{caption}</figcaption>
      <div className="vt-chart-bar">
        {series.length > 1 ? <Legend series={series} uid={uid} shape={shape} /> : <span />}
        {empty ? null : (
          <div className="vt-btn-group" role="group" aria-label={caption}>
            <Button size="sm" aria-pressed={view === 'chart'} onClick={() => setView('chart')}>
              {labels.chart}
            </Button>
            <Button size="sm" aria-pressed={view === 'table'} onClick={() => setView('table')}>
              {labels.table}
            </Button>
          </div>
        )}
      </div>
      {empty ? (
        <p className="vt-chart-empty" style={{ height }}>
          {emptyText}
        </p>
      ) : view === 'table' ? (
        <div className="vt-chart-table" style={{ maxHeight: Math.max(height, 320) }}>
          <Table
            caption={caption}
            density="compact"
            rows={rows}
            rowKey={(r) => String(r.i)}
            columns={[
              { key: 'category', header: labels.category },
              ...series.map((s) => ({
                key: s.id,
                header: s.label,
                numeric: true,
                render: (r: { i: number }) => (has(s.values[r.i]) ? fmt(s.values[r.i] as number) : ''),
              })),
              ...(showTotal
                ? [
                    {
                      key: '__total',
                      header: labels.total as string,
                      numeric: true,
                      render: (r: { i: number }) => fmt(series.reduce((sum, s) => sum + num(s.values[r.i]), 0)),
                    },
                  ]
                : []),
            ]}
          />
        </div>
      ) : (
        children({ fmt })
      )}
    </figure>
  )
}

interface TipRow {
  key: string
  color?: ChartColor
  label: string
  value: string
  strong?: boolean
}
function Tip({
  title,
  rows,
  x,
  side,
  top,
  shape,
}: {
  title: string
  rows: TipRow[]
  x: number
  side: 'left' | 'right'
  top: number
  shape: 'rect' | 'line'
}) {
  return (
    <div
      className="vt-chart-tip"
      style={side === 'right' ? { left: x + 12, top } : { right: `calc(100% - ${x - 12}px)`, top }}
      aria-hidden="true"
    >
      <p className="vt-chart-tip-title">{title}</p>
      {rows.map((r) => (
        <p key={r.key} className={cx('vt-chart-tip-row', r.strong && 'is-strong')}>
          {r.color ? (
            <span
              className={cx('vt-chart-tip-key', shape === 'rect' && 'is-rect')}
              style={{ background: fillOf(r.color) }}
            />
          ) : (
            <span className="vt-chart-tip-key" />
          )}
          <strong>{r.value}</strong>
          <span>{r.label}</span>
        </p>
      ))}
    </div>
  )
}

/** Pointer and keyboard on a plot: which category is being read. Arrow keys step through them, Escape lets go. */
function useActive(count: number, left: number, band: number) {
  const [active, setActive] = React.useState<number | null>(null)
  const at = (clientX: number, el: HTMLElement) =>
    Math.max(0, Math.min(count - 1, Math.floor((clientX - el.getBoundingClientRect().left - left) / band)))
  return {
    active,
    handlers: {
      onPointerMove: (e: React.PointerEvent<HTMLElement>) => setActive(at(e.clientX, e.currentTarget)),
      onPointerLeave: () => setActive(null),
      onFocus: () => setActive((a) => (a === null ? 0 : a)),
      onBlur: () => setActive(null),
      onKeyDown: (e: React.KeyboardEvent) => {
        let next: number | null | undefined
        if (e.key === 'ArrowRight') next = Math.min(count - 1, (active === null ? -1 : active) + 1)
        else if (e.key === 'ArrowLeft') next = Math.max(0, (active === null ? count : active) - 1)
        else if (e.key === 'Home') next = 0
        else if (e.key === 'End') next = count - 1
        else if (e.key === 'Escape') next = null
        if (next === undefined) return
        e.preventDefault()
        setActive(next)
      },
    },
  }
}

interface Layout {
  width: number
  left: number
  right: number
  top: number
  bottom: number
  plotW: number
  plotH: number
  band: number
  ticks: number[]
  y: (v: number) => number
  labelStep: number
}
function layoutOf(
  width: number,
  height: number,
  max: number,
  count: number,
  categories: string[],
  fmt: (v: number) => string,
  unit: string | undefined,
  extraTop: number,
  extraRight: number,
): Layout {
  const ticks = niceTicks(max)
  const scaleMax = ticks[ticks.length - 1]
  const left = Math.ceil(Math.max(...ticks.map((t) => textWidth(fmt(t))), unit ? textWidth(unit) : 0)) + 8
  const right = 8 + extraRight
  const top = (unit ? 28 : 8) + extraTop
  const bottom = 24
  const plotW = Math.max(count * 4, width - left - right)
  const plotH = Math.max(40, height - top - bottom)
  const band = plotW / Math.max(1, count)
  const widest = Math.max(0, ...categories.map((c) => textWidth(c)))
  return {
    width,
    left,
    right,
    top,
    bottom,
    plotW,
    plotH,
    band,
    ticks,
    y: (v) => top + plotH - (safe(v) / scaleMax) * plotH,
    labelStep: Math.max(1, Math.ceil((widest + 12) / band)),
  }
}

function Axes({
  l,
  categories,
  fmt,
  unit,
}: {
  l: Layout
  categories: string[]
  fmt: (v: number) => string
  unit?: string
}) {
  const base = l.top + l.plotH
  return (
    <>
      {unit ? (
        <text className="vt-chart-tick" x={l.left - 8} y={11} textAnchor="end">
          {unit}
        </text>
      ) : null}
      {l.ticks.map((t) => (
        <g key={t}>
          <line
            className={t === 0 ? 'vt-chart-axis' : 'vt-chart-grid'}
            x1={l.left}
            x2={l.left + l.plotW}
            y1={Math.round(l.y(t)) + 0.5}
            y2={Math.round(l.y(t)) + 0.5}
          />
          <text className="vt-chart-tick" x={l.left - 8} y={l.y(t) + 4} textAnchor="end">
            {fmt(t)}
          </text>
        </g>
      ))}
      {categories.map((c, i) =>
        i % l.labelStep === 0 ? (
          <text key={i} className="vt-chart-tick" x={l.left + (i + 0.5) * l.band} y={base + 17} textAnchor="middle">
            {c}
          </text>
        ) : null,
      )}
    </>
  )
}

/** A bar that grows from the baseline: square at the foot, rounded at the end that carries the value. */
function barPath(x: number, y: number, w: number, h: number, round: boolean): string {
  const r = round ? Math.min(4, w / 2, h) : 0
  return (
    'M' +
    x +
    ' ' +
    (y + h) +
    'V' +
    (y + r) +
    (r ? `Q${x} ${y} ${x + r} ${y}` : '') +
    'H' +
    (x + w - r) +
    (r ? `Q${x + w} ${y} ${x + w} ${y + r}` : '') +
    'V' +
    (y + h) +
    'Z'
  )
}

export interface BarChartProps extends ChartCommonProps {
  /** Sets the series on top of one another, for the parts of a whole. Default: side by side. */
  stacked?: boolean
}

/** Bars over categories: one series to compare amounts, several side by side or stacked to compare parts. */
export function BarChart(props: BarChartProps) {
  const uid = useUid()
  return (
    <Frame base={props} uid={uid} shape="rect" total={!!props.stacked}>
      {({ fmt }) => <BarPlot {...props} uid={uid} fmt={fmt} />}
    </Frame>
  )
}

function BarPlot({
  caption,
  categories,
  series,
  stacked = false,
  height = 240,
  unit,
  labels,
  busy,
  uid,
  fmt,
}: BarChartProps & { uid: string; fmt: (v: number) => string }) {
  const wrap = React.useRef<HTMLDivElement>(null)
  const width = useWidth(wrap)
  const count = categories.length
  const totals = categories.map((_, i) => series.reduce((sum, s) => sum + safe(s.values[i]), 0))
  const max = Math.max(0, ...(stacked ? totals : series.map((s) => Math.max(0, ...s.values.map(safe)))))
  const single = series.length === 1
  const l = layoutOf(width, height, max, count, categories, fmt, unit, single ? 16 : 0, 0)
  const { active, handlers } = useActive(count, l.left, l.band)
  const base = l.top + l.plotH
  const k = stacked ? 1 : series.length
  const thick = Math.max(2, Math.min(24, (l.band * 0.72 - (k - 1) * 2) / k))
  const group = k * thick + (k - 1) * 2
  // a value on the cap of every bar, only for one series and only when every label fits its band
  const capLabels =
    single &&
    categories.every(
      (_, i) => !has(series[0].values[i]) || textWidth(fmt(series[0].values[i] as number), 500) + 6 <= l.band,
    )
  const readout = (i: number) =>
    categories[i] +
    ': ' +
    series.map((s) => `${s.label} ${has(s.values[i]) ? fmt(s.values[i] as number) : '–'}`).join(', ')

  const marks: React.ReactNode[] = []
  categories.forEach((_, i) => {
    const x0 = l.left + i * l.band + (l.band - group) / 2
    if (stacked) {
      let y = base
      const last = series.reduce((at, s, j) => (safe(s.values[i]) > 0 ? j : at), -1)
      series.forEach((s, j) => {
        const h = (safe(s.values[i]) / l.ticks[l.ticks.length - 1]) * l.plotH
        if (h <= 0) return
        const c = slotOf(s, j)
        // a 2px gap of surface between the segments of a stack
        const gap = j === last ? 0 : Math.min(2, Math.max(0, h - 1))
        const d = barPath(x0, y - h + gap, thick, h - gap, j === last)
        marks.push(<path key={`b:${i}:${s.id}`} d={d} fill={fillOf(c)} />)
        if (textureOf(uid, c))
          marks.push(<path key={`t:${i}:${s.id}`} className="vt-chart-texture" d={d} fill={textureOf(uid, c)} />)
        y -= h
      })
    } else {
      series.forEach((s, j) => {
        if (!has(s.values[i])) return
        const h = Math.max(safe(s.values[i]) > 0 ? 1 : 0, base - l.y(s.values[i] as number))
        const c = slotOf(s, j)
        const x = x0 + j * (thick + 2)
        const d = barPath(x, base - h, thick, h, true)
        if (h > 0) marks.push(<path key={`b:${i}:${s.id}`} d={d} fill={fillOf(c)} />)
        if (h > 0 && textureOf(uid, c))
          marks.push(<path key={`t:${i}:${s.id}`} className="vt-chart-texture" d={d} fill={textureOf(uid, c)} />)
        if (capLabels)
          marks.push(
            <text
              key={`v:${i}:${s.id}`}
              className="vt-chart-value"
              x={x + thick / 2}
              y={base - h - 6}
              textAnchor="middle"
            >
              {fmt(s.values[i] as number)}
            </text>,
          )
      })
    }
  })

  const tipRows: TipRow[] =
    active === null
      ? []
      : [
          ...series.map((s, j) => ({
            key: s.id,
            color: slotOf(s, j),
            label: s.label,
            value: has(s.values[active]) ? fmt(s.values[active] as number) : '–',
          })),
          ...(stacked && labels.total && series.length > 1
            ? [
                {
                  key: '__total',
                  label: labels.total,
                  value: fmt(series.reduce((sum, s) => sum + num(s.values[active]), 0)),
                  strong: true,
                },
              ]
            : []),
        ]

  return (
    <div
      ref={wrap}
      className={cx('vt-chart-plot', busy && 'is-busy')}
      style={{ height }}
      tabIndex={0}
      role="group"
      aria-label={caption}
      aria-busy={busy || undefined}
      {...handlers}
    >
      {width > 0 ? (
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMinYMin meet"
          aria-hidden="true"
          focusable="false"
        >
          <Textures uid={uid} />
          {active !== null ? (
            <rect className="vt-chart-band" x={l.left + active * l.band} y={l.top} width={l.band} height={l.plotH} />
          ) : null}
          <Axes l={l} categories={categories} fmt={fmt} unit={unit} />
          {marks}
        </svg>
      ) : null}
      {active !== null && width > 0 ? (
        <Tip
          title={categories[active]}
          rows={single ? tipRows.map((r) => ({ ...r, color: undefined })) : tipRows}
          x={l.left + (active + 0.5) * l.band}
          side={active < count / 2 ? 'right' : 'left'}
          top={l.top}
          shape="rect"
        />
      ) : null}
      <p className="vt-sr" aria-live="polite">
        {active !== null ? readout(active) : ''}
      </p>
    </div>
  )
}

export interface LineChartProps extends ChartCommonProps {
  /** A light wash under the first series, down to the baseline. For one series, or one against a grey comparison. */
  area?: boolean
}

/** Lines over time: how one to five things change from step to step. */
export function LineChart(props: LineChartProps) {
  const uid = useUid()
  return (
    <Frame base={props} uid={uid} shape="line" total={false}>
      {({ fmt }) => <LinePlot {...props} fmt={fmt} />}
    </Frame>
  )
}

function LinePlot({
  caption,
  categories,
  series,
  area = false,
  height = 240,
  unit,
  busy,
  fmt,
}: LineChartProps & { fmt: (v: number) => string }) {
  const wrap = React.useRef<HTMLDivElement>(null)
  const width = useWidth(wrap)
  const count = categories.length
  const max = Math.max(0, ...series.map((s) => Math.max(0, ...s.values.map(safe))))
  const lastOf = (s: ChartSeries) => {
    for (let i = Math.min(count, s.values.length) - 1; i >= 0; i--) if (has(s.values[i])) return i
    return -1
  }
  // the name of each line at its end, for two to four lines that finish apart from one another
  const first = layoutOf(width, height, max, count, categories, fmt, unit, 0, 0)
  const ends = series.map((s) => ({ s, i: lastOf(s) })).filter((e) => e.i === count - 1)
  const endYs = ends.map((e) => first.y(e.s.values[e.i] as number)).sort((a, b) => a - b)
  const apart = endYs.every((yy, i) => i === 0 || yy - endYs[i - 1] >= 16)
  const direct = series.length >= 2 && series.length <= 4 && ends.length === series.length && apart && width >= 480
  const l = direct
    ? layoutOf(
        width,
        height,
        max,
        count,
        categories,
        fmt,
        unit,
        0,
        Math.ceil(Math.max(...series.map((s) => textWidth(s.label)))) + 12,
      )
    : first
  const { active, handlers } = useActive(count, l.left, l.band)
  const base = l.top + l.plotH
  const xAt = (i: number) => l.left + (i + 0.5) * l.band
  const readout = (i: number) =>
    categories[i] +
    ': ' +
    series.map((s) => `${s.label} ${has(s.values[i]) ? fmt(s.values[i] as number) : '–'}`).join(', ')

  const paths = series.map((s, j) => {
    let d = ''
    let pen = false
    for (let i = 0; i < count; i++) {
      if (!has(s.values[i])) {
        pen = false
        continue
      }
      d += `${(pen ? 'L' : 'M') + xAt(i).toFixed(1)} ${l.y(s.values[i] as number).toFixed(1)}`
      pen = true
    }
    return { s, c: slotOf(s, j), d, end: lastOf(s) }
  })
  let wash = ''
  if (area && paths[0]?.d && paths[0].end >= 0) {
    const s = paths[0].s
    const firstAt = s.values.findIndex(has)
    wash =
      paths[0].d.replace(/M/g, (_m, at: number) => (at === 0 ? 'M' : 'L')) +
      'L' +
      xAt(paths[0].end).toFixed(1) +
      ' ' +
      base +
      'L' +
      xAt(firstAt).toFixed(1) +
      ' ' +
      base +
      'Z'
  }

  return (
    <div
      ref={wrap}
      className={cx('vt-chart-plot', busy && 'is-busy')}
      style={{ height }}
      tabIndex={0}
      role="group"
      aria-label={caption}
      aria-busy={busy || undefined}
      {...handlers}
    >
      {width > 0 ? (
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMinYMin meet"
          aria-hidden="true"
          focusable="false"
        >
          <Axes l={l} categories={categories} fmt={fmt} unit={unit} />
          {wash ? <path d={wash} fill={fillOf(paths[0].c)} opacity="0.1" /> : null}
          {active !== null ? (
            <line
              className="vt-chart-cross"
              x1={Math.round(xAt(active)) + 0.5}
              x2={Math.round(xAt(active)) + 0.5}
              y1={l.top}
              y2={base}
            />
          ) : null}
          {paths.map((p) =>
            p.d ? <path key={p.s.id} className="vt-chart-line" d={p.d} stroke={fillOf(p.c)} /> : null,
          )}
          {paths.map((p) =>
            p.end >= 0 ? (
              <circle
                key={p.s.id}
                className="vt-chart-dot"
                cx={xAt(p.end)}
                cy={l.y(p.s.values[p.end] as number)}
                r="4"
                fill={fillOf(p.c)}
              />
            ) : null,
          )}
          {active !== null
            ? paths.map((p) =>
                has(p.s.values[active]) ? (
                  <circle
                    key={`${p.s.id}-a`}
                    className="vt-chart-dot"
                    cx={xAt(active)}
                    cy={l.y(p.s.values[active] as number)}
                    r="4"
                    fill={fillOf(p.c)}
                  />
                ) : null,
              )
            : null}
          {direct
            ? paths.map((p) => (
                <text
                  key={`${p.s.id}-l`}
                  className="vt-chart-end"
                  x={xAt(count - 1) + 10}
                  y={l.y(p.s.values[count - 1] as number) + 4}
                >
                  {p.s.label}
                </text>
              ))
            : null}
        </svg>
      ) : null}
      {active !== null && width > 0 ? (
        <Tip
          title={categories[active]}
          rows={series.map((s, j) => ({
            key: s.id,
            color: series.length > 1 ? slotOf(s, j) : undefined,
            label: s.label,
            value: has(s.values[active]) ? fmt(s.values[active] as number) : '–',
          }))}
          x={xAt(active)}
          side={active < count / 2 ? 'right' : 'left'}
          top={l.top}
          shape="line"
        />
      ) : null}
      <p className="vt-sr" aria-live="polite">
        {active !== null ? readout(active) : ''}
      </p>
    </div>
  )
}

export interface BarListItem {
  id: string
  /** What is measured: a service, a veterinarian, a product. */
  label: string
  value: number
  /** A second line under the label: "42 visits". */
  detail?: string
}

export interface BarListProps {
  /** What the list ranks. Its accessible name. Not shown. */
  caption: string
  /** In the order to show them: highest first. */
  items: BarListItem[]
  /** Headings of the two columns, for screen readers: "Service", "Revenue, ₼". */
  labels: { name: string; value: string }
  /** Writes a value. Default `Vetora.formatNumber`. */
  format?: (value: number) => string
  locale?: string
  /** The value a full bar stands for. Default: the highest value in the list. */
  max?: number
  /** Slot of the palette. Default 1. One colour for every bar: the bars differ in length, not in kind. */
  color?: ChartColor
  /** Shown when there are no items. */
  emptyText?: string
  className?: string
}

/** A ranked list with a bar beside each name: the top services, the busiest veterinarians. */
export function BarList({
  caption,
  items,
  labels,
  format,
  locale,
  max,
  color = 1,
  emptyText,
  className,
}: BarListProps) {
  const fmt = format || ((v: number) => formatNumber(v, { locale }))
  const top = max !== undefined ? max : Math.max(0, ...items.map((i) => safe(i.value)))
  if (items.length === 0) return <p className={cx('vt-chart-empty', className)}>{emptyText}</p>
  return (
    <table className={cx('vt-barlist', className)}>
      <caption className="vt-sr">{caption}</caption>
      <thead className="vt-sr">
        <tr>
          <th scope="col">{labels.name}</th>
          <th scope="col">{labels.value}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id}>
            <th scope="row">
              <span className="vt-barlist-label">{item.label}</span>
              {item.detail ? <span className="vt-barlist-detail">{item.detail}</span> : null}
              <span className="vt-barlist-track" aria-hidden="true">
                <span
                  className="vt-barlist-bar"
                  style={{
                    width: `${top > 0 ? Math.min(100, (safe(item.value) / top) * 100) : 0}%`,
                    background: fillOf(color),
                  }}
                />
              </span>
            </th>
            <td>{fmt(item.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export interface HeatGridProps {
  /** What the grid shows. Its accessible name and the caption of the table. Not shown. */
  caption: string
  /** Names of the rows: days of the week. */
  rows: string[]
  /** Names of the columns: hours of the day. */
  columns: string[]
  /** One row of values for each row name. `null` for a cell with nothing to count: the clinic is closed. */
  values: Array<Array<number | null>>
  /** The words at the two ends of the scale under the grid: "Fewer", "More". */
  labels: { low: string; high: string }
  /** Writes a value. Default `Vetora.formatNumber`. */
  format?: (value: number) => string
  locale?: string
  /** The value the darkest step stands for. Default: the highest value in the grid. */
  max?: number
  /** Writes the value in each cell. Default true. Without it the value is the cell's tooltip. */
  showValues?: boolean
  className?: string
}

/** A grid of amounts, darker for more: the busiest hours of the week. */
export function HeatGrid({
  caption,
  rows,
  columns,
  values,
  labels,
  format,
  locale,
  max,
  showValues = true,
  className,
}: HeatGridProps) {
  const fmt = format || ((v: number) => formatNumber(v, { locale }))
  const top = max !== undefined ? max : Math.max(0, ...values.map((r) => Math.max(0, ...r.map(safe))))
  const stepOf = (v: number | null | undefined) =>
    !has(v) ? -1 : v <= 0 || top <= 0 ? 0 : Math.max(1, Math.min(5, Math.ceil((v / top) * 5)))
  return (
    <div className={cx('vt-heat', className)}>
      <table>
        <caption className="vt-sr">{caption}</caption>
        <thead>
          <tr>
            <td />
            {columns.map((c, i) => (
              <th key={i} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              <th scope="row">{row}</th>
              {columns.map((_c, i) => {
                const v = values[r] ? values[r][i] : null
                const step = stepOf(v)
                return (
                  <td
                    key={i}
                    className={step < 0 ? 'is-none' : `vt-heat-${step}`}
                    title={!showValues && has(v) ? fmt(v) : undefined}
                  >
                    {has(v) ? showValues ? fmt(v) : <span className="vt-sr">{fmt(v)}</span> : null}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="vt-heat-scale" aria-hidden="true">
        {labels.low}
        <span>
          {[1, 2, 3, 4, 5].map((s) => (
            <i key={s} className={`vt-heat-${s}`} />
          ))}
        </span>
        {labels.high}
      </p>
    </div>
  )
}

export interface StatDelta {
  /** The change, signed and with its unit: "+8,2%", "−2". */
  text: string
  /** Which way it went. Sets the arrow. */
  direction: 'up' | 'down' | 'flat'
  /** Whether that is good news. Sets the colour: a fall in no-shows is good, a fall in revenue is bad. Left out, the change is neutral. */
  good?: boolean
  /** What it is compared with: "against last month". */
  note?: string
}

export interface StatProps {
  /** What is counted: "Revenue", "New clients". Sentence case, no colon. */
  label: string
  /** The figure, already written out: "12 480,00 ₼", "214". */
  value: React.ReactNode
  /** The change from the period before. */
  delta?: StatDelta
  /** Up to twelve earlier values and the current one last, for a small line of the trend. */
  trend?: number[]
  className?: string
}

/** One headline figure with its change and its trend. */
export function Stat({ label, value, delta, trend, className }: StatProps) {
  let spark: React.ReactNode = null
  if (trend && trend.length > 1) {
    const w = 80
    const h = 24
    const lo = Math.min(...trend)
    const hi = Math.max(...trend)
    const x = (i: number) => 4 + (i * (w - 8)) / (trend.length - 1)
    const y = (v: number) => (hi === lo ? h / 2 : h - 4 - ((v - lo) / (hi - lo)) * (h - 8))
    spark = (
      <svg className="vt-stat-trend" width={w} height={h} aria-hidden="true" focusable="false">
        <path
          className="vt-chart-line"
          d={trend.map((v, i) => `${(i ? 'L' : 'M') + x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('')}
          stroke="var(--chart-other)"
          style={{ strokeWidth: 1.5 }}
        />
        <circle
          className="vt-chart-dot"
          cx={x(trend.length - 1)}
          cy={y(trend[trend.length - 1])}
          r="3"
          fill="var(--chart-1)"
        />
      </svg>
    )
  }
  return (
    <div className={cx('vt-stat', className)}>
      <div className="vt-stat-head">
        <p className="vt-stat-label">{label}</p>
        {spark}
      </div>
      <p className="vt-stat-value">{value}</p>
      {delta ? (
        <p className="vt-stat-delta">
          <span className={cx('vt-stat-change', delta.good === true && 'is-good', delta.good === false && 'is-bad')}>
            {delta.direction === 'flat' ? null : (
              <Icon name={delta.direction === 'up' ? 'arrow_upward' : 'arrow_downward'} size="sm" />
            )}
            {delta.text}
          </span>
          {delta.note ? <span className="vt-stat-note">{delta.note}</span> : null}
        </p>
      ) : null}
    </div>
  )
}

export interface StatGroupProps {
  /** Names the row for screen readers: "This month". */
  label: string
  /** Two to four `Stat`. */
  children: React.ReactNode
  className?: string
}

/**
 * A row of headline figures, of equal width. Two to four: they share one row while each has room, four fall to two by two,
 * and then to one column. Never three and one.
 */
export function StatGroup({ label, children, className }: StatGroupProps) {
  return (
    <div className={cx('vt-stats', className)} role="group" aria-label={label}>
      <div className="vt-stats-row" data-count={React.Children.toArray(children).length}>
        {children}
      </div>
    </div>
  )
}
