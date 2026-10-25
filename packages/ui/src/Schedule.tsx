import * as React from 'react'
import { type AppointmentStatus, appointmentBadge } from './appointment.js'
import { Icon } from './Icon.js'
import { cx } from './util.js'

export interface ScheduleColumn {
  id: string
  /** The vet's name in a day view; the weekday and date in a week view. */
  title: string
  /** A second line: the room, or the number of appointments. */
  subtitle?: string
  /** Marks today's column in a week view. The current-time line is drawn only there. */
  current?: boolean
}

export interface ScheduleEvent {
  id: string
  /** The column it belongs to. */
  columnId: string
  /** Start and end as HH:MM on the 24-hour clock. */
  start: string
  end: string
  /** The patient's name. */
  title: string
  /** The appointment type and reason in words: "Vaccination · Rabies". Always give the type here: colour alone does not say it. */
  detail?: string
  /** Colour of the appointment type: 1 blue, 2 sky, 3 violet, 4 plum. Left out, the appointment is white. */
  category?: 1 | 2 | 3 | 4
  /** Where the appointment stands. Sets its icon and its border. */
  status?: AppointmentStatus
  /** The status in words, in the interface language: "Confirmed". Read out and shown on hover. */
  statusLabel?: string
}

export interface ScheduleBlock {
  id: string
  columnId: string
  start: string
  end: string
  /** Why the time is closed: "Lunch", "Day off". */
  label: string
}

export interface ScheduleProps {
  /** Names the schedule for screen readers: "Schedule, Monday 12 October". */
  label: string
  /** Vets for a day view, days for a week view. */
  columns: ScheduleColumn[]
  events: ScheduleEvent[]
  /** Closed time: breaks, days off. */
  blocks?: ScheduleBlock[]
  /** First and last hour shown, as HH:MM. Rounded out to whole hours. Default 08:00 to 20:00. */
  from?: string
  to?: string
  /** Minutes in one row of the grid: the clinic's shortest appointment. Default 30. */
  slotMinutes?: 15 | 20 | 30 | 60
  /** The current time as HH:MM. Draws the line across today's columns. Leave out when the day shown is not today. */
  now?: string
  /** Id of the appointment that is open in a drawer. */
  selectedId?: string
  /** Called when an appointment is pressed. */
  onEventClick?: (event: ScheduleEvent) => void
  /** Called with the column and the time when free time is pressed. Offer the same action as a button on the page, for the keyboard. */
  onSlotClick?: (columnId: string, time: string) => void
  /** Tallest the schedule gets before it scrolls: a number is pixels. */
  maxHeight?: number | string
  className?: string
}

export interface ScheduleKeyItem {
  /** The category, or none for the white, uncoloured kind. */
  category?: 1 | 2 | 3 | 4
  /** The appointment type it stands for: "Vaccination". */
  label: string
}

export interface ScheduleKeyProps {
  /** Names the key for screen readers: "Appointment types". */
  label: string
  items: ScheduleKeyItem[]
  className?: string
}

/** The key to the schedule's colours: one swatch and name per appointment type. */
export function ScheduleKey({ label, items, className }: ScheduleKeyProps) {
  return (
    <ul className={cx('vt-key', className)} aria-label={label}>
      {items.map((item) => (
        <li key={item.label}>
          <span className={cx('vt-key-swatch', item.category && `vt-appt-cat-${item.category}`)} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

const minutes = (hhmm: string) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5)
const clock = (total: number) =>
  `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`

interface Placed {
  event: ScheduleEvent
  lane: number
  lanes: number
}

/** Puts appointments that overlap in time side by side. */
function place(events: ScheduleEvent[]): Placed[] {
  const sorted = [...events].sort((a, b) => minutes(a.start) - minutes(b.start) || minutes(b.end) - minutes(a.end))
  const out: Placed[] = []
  let cluster: Placed[] = []
  let laneEnds: number[] = []
  let clusterEnd = -1
  const close = () => {
    for (const p of cluster) p.lanes = laneEnds.length
    cluster = []
    laneEnds = []
  }
  for (const event of sorted) {
    const start = minutes(event.start)
    const end = Math.max(minutes(event.end), start + 1)
    if (cluster.length && start >= clusterEnd) close()
    let lane = laneEnds.findIndex((e) => e <= start)
    if (lane < 0) lane = laneEnds.length
    laneEnds[lane] = end
    clusterEnd = Math.max(clusterEnd, end)
    const placed = { event, lane, lanes: 1 }
    cluster.push(placed)
    out.push(placed)
  }
  close()
  return out
}

/** The clinic's appointments laid out on a time grid: a day by vet, or a week by day. */
export function Schedule({
  label,
  columns,
  events,
  blocks = [],
  from = '08:00',
  to = '20:00',
  slotMinutes = 30,
  now,
  selectedId,
  onEventClick,
  onSlotClick,
  maxHeight,
  className,
}: ScheduleProps) {
  const first = Math.floor(minutes(from) / 60) * 60
  const last = Math.max(Math.ceil(minutes(to) / 60) * 60, first + 60)
  const slots = (last - first) / slotMinutes
  const perHour = 60 / slotMinutes
  const id = React.useId()
  const [ghost, setGhost] = React.useState<{ column: string; slot: number } | null>(null)
  const root = React.useRef<HTMLDivElement>(null)

  const top = (hhmm: string) =>
    `calc(var(--schedule-slot) * ${(Math.min(Math.max(minutes(hhmm), first), last) - first) / slotMinutes})`
  const span = (start: string, end: string) => {
    const a = Math.min(Math.max(minutes(start), first), last)
    const b = Math.min(Math.max(minutes(end), first), last)
    return `max(var(--schedule-slot), calc(var(--schedule-slot) * ${(b - a) / slotMinutes}))`
  }
  const hours: number[] = []
  for (let t = first; t < last; t += 60) hours.push(t)
  const anyCurrent = columns.some((c) => c.current)
  const showNow = now !== undefined && minutes(now) >= first && minutes(now) <= last

  const slotAt = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    return Math.min(slots - 1, Math.max(0, Math.floor(((e.clientY - box.top) / box.height) * slots)))
  }

  // Arrow keys move between appointments: up and down within a column, left and right to the nearest in time next door.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const here = (e.target as HTMLElement).closest<HTMLElement>('.vt-appt')
    if (!here || !root.current) return
    const cols = Array.from(root.current.querySelectorAll<HTMLElement>('.vt-sched-col'))
    const ci = cols.findIndex((c) => c.contains(here))
    const inCol = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('.vt-appt'))
    const list = inCol(cols[ci])
    const i = list.indexOf(here)
    let target: HTMLElement | undefined
    if (e.key === 'ArrowDown') target = list[i + 1]
    else if (e.key === 'ArrowUp') target = list[i - 1]
    else if (e.key === 'Home') target = list[0]
    else if (e.key === 'End') target = list[list.length - 1]
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const step = e.key === 'ArrowRight' ? 1 : -1
      const at = +(here.dataset.start || 0)
      for (let c = ci + step; c >= 0 && c < cols.length && !target; c += step) {
        target = inCol(cols[c]).sort(
          (a, b) => Math.abs(+(a.dataset.start || 0) - at) - Math.abs(+(b.dataset.start || 0) - at),
        )[0]
      }
    } else return
    e.preventDefault()
    if (target) target.focus()
  }

  const vars = { '--vt-cols': columns.length, '--vt-slots': slots, '--vt-per-hour': perHour } as React.CSSProperties

  return (
    <div
      ref={root}
      className={cx('vt-sched', className)}
      role="group"
      aria-label={label}
      style={{ ...vars, maxHeight }}
      onKeyDown={onKeyDown}
    >
      <div className="vt-sched-head">
        <div className="vt-sched-corner" aria-hidden="true" />
        {columns.map((c) => (
          <div
            key={c.id}
            id={`${id}-${c.id}`}
            className={cx('vt-sched-colhead', c.current && 'is-current')}
            aria-current={c.current ? 'date' : undefined}
          >
            <span className="vt-sched-title">{c.title}</span>
            {c.subtitle ? <span className="vt-sched-sub">{c.subtitle}</span> : null}
          </div>
        ))}
      </div>
      <div className="vt-sched-body">
        <div className="vt-sched-times" aria-hidden="true">
          {hours.map((t) => (
            <span key={t} style={{ top: `calc(var(--schedule-slot) * ${(t - first) / slotMinutes})` }}>
              {clock(t)}
            </span>
          ))}
          {showNow ? (
            <span className="vt-sched-nowtime" style={{ top: top(now as string) }}>
              {now}
            </span>
          ) : null}
        </div>
        {columns.map((c) => {
          const placed = place(
            events.filter((ev) => ev.columnId === c.id && minutes(ev.start) < last && minutes(ev.end) > first),
          )
          return (
            <div
              key={c.id}
              className={cx('vt-sched-col', onSlotClick && 'is-clickable')}
              role="group"
              aria-labelledby={`${id}-${c.id}`}
              onMouseMove={
                onSlotClick
                  ? (e) =>
                      setGhost(
                        (e.target as HTMLElement).closest('.vt-appt, .vt-sched-block')
                          ? null
                          : { column: c.id, slot: slotAt(e) },
                      )
                  : undefined
              }
              onMouseLeave={onSlotClick ? () => setGhost(null) : undefined}
              onClick={
                onSlotClick
                  ? (e) => {
                      if ((e.target as HTMLElement).closest('.vt-appt, .vt-sched-block')) return
                      onSlotClick(c.id, clock(first + slotAt(e) * slotMinutes))
                    }
                  : undefined
              }
            >
              {blocks
                .filter((b) => b.columnId === c.id)
                .map((b) => (
                  <div
                    key={b.id}
                    className="vt-sched-block"
                    style={{ top: top(b.start), height: span(b.start, b.end) }}
                  >
                    <span>{b.label}</span>
                  </div>
                ))}
              {ghost && ghost.column === c.id ? (
                <div
                  className="vt-sched-ghost"
                  aria-hidden="true"
                  style={{ top: `calc(var(--schedule-slot) * ${ghost.slot})` }}
                >
                  <Icon name="add" size="sm" />
                  <span>{clock(first + ghost.slot * slotMinutes)}</span>
                </div>
              ) : null}
              {showNow && (c.current || !anyCurrent) ? (
                <div className="vt-sched-now" aria-hidden="true" style={{ top: top(now as string) }} />
              ) : null}
              <ul>
                {placed.map(({ event, lane, lanes }) => {
                  const icon = event.status ? appointmentBadge(event.status).icon : undefined
                  const short = minutes(event.end) - minutes(event.start) < slotMinutes * 2
                  const name = [`${event.start}–${event.end}`, event.title, event.detail, event.statusLabel]
                    .filter(Boolean)
                    .join(', ')
                  return (
                    <li
                      key={event.id}
                      style={{
                        top: top(event.start),
                        height: span(event.start, event.end),
                        left: `${(lane / lanes) * 100}%`,
                        width: `${100 / lanes}%`,
                      }}
                    >
                      <button
                        type="button"
                        className={cx(
                          'vt-appt',
                          event.category && `vt-appt-cat-${event.category}`,
                          event.status && `is-${event.status}`,
                          short && 'is-short',
                          event.id === selectedId && 'is-selected',
                        )}
                        data-start={minutes(event.start)}
                        aria-label={name}
                        aria-pressed={selectedId !== undefined ? event.id === selectedId : undefined}
                        title={event.statusLabel}
                        onClick={() => onEventClick?.(event)}
                      >
                        <span className="vt-appt-main">
                          <span className="vt-appt-time">{event.start}</span>
                          <span className="vt-appt-title">{event.title}</span>
                          {short && event.detail ? <span className="vt-appt-inline">{event.detail}</span> : null}
                          {icon ? <Icon name={icon} size="sm" filled={event.status === 'completed'} /> : null}
                        </span>
                        {!short && event.detail ? <span className="vt-appt-detail">{event.detail}</span> : null}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}
