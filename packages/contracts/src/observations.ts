import { z } from 'zod'
import type { Action } from './staff.js'
import { VisitPath } from './visits.js'

/**
 * The vital signs of a visit (spec #18, "Tables": `clinical_observation`; #23). A reading is append only: a corrected
 * weight is a new reading, and the newest is the one in force (PT-2, CR-3). The plausible range of each kind is
 * defined here once, for the API to refuse and the web app to check before it sends; a reading outside it is a slip of
 * the finger, not a finding, and no range flags are shown (they need per species ranges, PT-3).
 */

/** What a reading measures, as the table holds it (spec 0002's sketch). */
export const OBSERVATION_KINDS = [
  'weight',
  'temperature',
  'pulse',
  'respiratory_rate',
  'body_condition',
  'other',
] as const
export const ObservationKind = z.enum(OBSERVATION_KINDS)
export type ObservationKind = z.infer<typeof ObservationKind>

/** The kinds the visit page records; body condition and other have no screen yet. */
export const VITAL_KINDS = ['weight', 'temperature', 'pulse', 'respiratory_rate'] as const
export const VitalKind = z.enum(VITAL_KINDS)
export type VitalKind = z.infer<typeof VitalKind>

/** Each kind's unit and plausible range, ends included: weight in kg, temperature in °C, pulse and breaths per minute. */
export const VITAL_SIGNS = {
  weight: { unit: 'kg', min: 0.01, max: 200 },
  temperature: { unit: '°C', min: 30, max: 45 },
  pulse: { unit: '/min', min: 10, max: 500 },
  respiratory_rate: { unit: '/min', min: 2, max: 300 },
} as const satisfies Record<VitalKind, { unit: string; min: number; max: number }>

/** The permission matrix action a reading of this kind needs: weight is the one whoever is free takes (story 40). */
export function actionOfReading(kind: VitalKind): Extract<Action, 'recordWeight' | 'recordVitalSignsAndNote'> {
  return kind === 'weight' ? 'recordWeight' : 'recordVitalSignsAndNote'
}

/** The path of one reading: its visit and its id, a UUID v7 the client generates. */
export const ObservationPath = VisitPath.extend({ observationId: z.uuidv7() })
export type ObservationPath = z.infer<typeof ObservationPath>

/** Three decimals is what the table keeps (`numeric(10,3)`). */
const hasThreeDecimalsAtMost = (value: number) => Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-6

/** PUT /api/p/{practiceId}/visits/{visitId}/observations/{observationId} request: one reading, timed now by the API. */
export const NewObservation = z
  .object({
    kind: VitalKind,
    /** In the kind's unit, within its plausible range, with at most three decimals. */
    value: z.number().refine(hasThreeDecimalsAtMost, 'At most three decimals'),
    /** Required, and the kind's own: kg, °C or /min. */
    unit: z.string(),
  })
  .superRefine((reading, ctx) => {
    const sign = VITAL_SIGNS[reading.kind]
    if (reading.unit !== sign.unit) ctx.addIssue({ code: 'custom', path: ['unit'], message: `Use ${sign.unit}` })
    if (reading.value < sign.min || reading.value > sign.max) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: `Between ${sign.min} and ${sign.max} ${sign.unit}` })
    }
  })
export type NewObservation = z.infer<typeof NewObservation>

/** A reading as stored: what was measured, in which unit, when, and by whom (CR-3). */
export const Observation = z.object({
  id: z.uuid(),
  kind: ObservationKind,
  value: z.number(),
  unit: z.string(),
  /** UTC instant, shown in the practice's time zone. */
  occurredAt: z.iso.datetime(),
  measuredBy: z.object({ id: z.uuid(), displayName: z.string() }),
})
export type Observation = z.infer<typeof Observation>

/** GET /api/p/{practiceId}/visits/{visitId}/observations response: the visit's readings, oldest first. */
export const Observations = z.object({ observations: z.array(Observation) })
export type Observations = z.infer<typeof Observations>

/** GET /api/p/{practiceId}/patients/{patientId}/last-weight query. */
export const LastWeightQuery = z.object({
  /**
   * A visit whose readings do not count: the visit page names its own, so the line under the weight field keeps the
   * weight from before this visit and a change shows at once (story 41).
   */
  excludingVisit: z.uuid().optional(),
})
export type LastWeightQuery = z.infer<typeof LastWeightQuery>

/** GET /api/p/{practiceId}/patients/{patientId}/last-weight response: the newest weight across the patient's visits. */
export const LastWeight = z.object({ lastWeight: Observation.nullable() })
export type LastWeight = z.infer<typeof LastWeight>
