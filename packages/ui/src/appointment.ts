import type { IconName } from './icons.js'
import type { Status } from './util.js'

/** The seven states an appointment can be in. One at a time. */
export type AppointmentStatus =
  | 'unconfirmed'
  | 'confirmed'
  | 'waiting'
  | 'in-progress'
  | 'completed'
  | 'cancelled'
  | 'no-show'

const STYLE: Record<AppointmentStatus, { status: Status; icon: IconName }> = {
  unconfirmed: { status: 'neutral', icon: 'event' },
  confirmed: { status: 'success', icon: 'event_available' },
  waiting: { status: 'warning', icon: 'hourglass_empty' },
  'in-progress': { status: 'info', icon: 'pending' },
  completed: { status: 'neutral', icon: 'check_circle' },
  cancelled: { status: 'neutral', icon: 'cancel' },
  'no-show': { status: 'danger', icon: 'event_busy' },
}

/**
 * The colour and icon of an appointment status, as props for a Badge:
 * `<Badge {...appointmentBadge('waiting')}>Waiting</Badge>`. The Schedule uses the same icons.
 */
export function appointmentBadge(status: AppointmentStatus): { status: Status; icon: IconName } {
  return STYLE[status]
}
