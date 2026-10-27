import { createRoute, type RouteHandler } from '@hono/zod-openapi'
import {
  type Action,
  actionOfReading,
  LastWeight,
  LastWeightQuery,
  NewObservation,
  ObservationPath,
  Observation as ObservationSchema,
  Observations,
  PatientPath,
  PracticeHeaders,
  VisitPath,
  VitalKind,
} from '@vetora/contracts'
import type { Context } from 'hono'
import {
  lastWeight,
  type ObservationRow,
  recordObservation,
  visitObservations,
} from '../modules/clinical-record/index.js'
import { problem } from '../platform/problem.js'
import type { Env } from './env.js'
import { practiceRoute, refusals } from './practice-context.js'

/**
 * The vital signs of a visit (#23; spec #18, "Tables": `clinical_observation`; stories 39 to 42): a reading recorded
 * on a visit, the visit's readings, and the patient's last weight. A reading carries its UUID v7, so a retry changes
 * nothing; the plausible range and unit of each kind are the contracts' (`NewObservation`), and the measurer is the
 * actor, timed now. Who may record depends on the kind (the matrix): a weight is whoever is free (receptionist,
 * assistant or vet), the other vital signs an assistant or a vet; every role but the groomer reads.
 */

/**
 * The action a reading needs, from the kind in its body: the weight's, or the other vital signs' when the kind is
 * anything else or cannot be read, the stricter of the two (validation then answers what is wrong with it).
 */
async function readingAction(c: Context<Env>): Promise<Action> {
  const body: unknown = await c.req.json().catch(() => undefined)
  const kind = VitalKind.safeParse(typeof body === 'object' && body !== null && 'kind' in body ? body.kind : undefined)
  return kind.success ? actionOfReading(kind.data) : 'recordVitalSignsAndNote'
}

const notFound = { 404: { description: 'No such visit, or a cancelled one (problem details)' } } as const

export const recordObservationRoute = createRoute({
  method: 'put',
  path: '/api/p/{practiceId}/visits/{visitId}/observations/{observationId}',
  middleware: [practiceRoute(readingAction)],
  summary: 'Record a vital sign',
  description:
    "Records one reading on a visit, for its patient, at the request's location, timed now and measured by the actor; a weight by a receptionist, an assistant or a vet, the other vital signs by an assistant or a vet. The reading id is a UUID v7 the client generates: the same request again changes nothing. A corrected value is a new reading; the earlier one stays.",
  request: {
    params: ObservationPath,
    headers: PracticeHeaders,
    body: { content: { 'application/json': { schema: NewObservation } }, required: true },
  },
  responses: {
    200: { description: 'Recorded', content: { 'application/json': { schema: ObservationSchema } } },
    ...notFound,
    409: {
      description:
        "The visit is completed (problem details naming vetora.frozen_record), or the reading id is another visit's reading",
    },
    ...refusals,
  },
})

export const visitObservationsRoute = createRoute({
  method: 'get',
  path: '/api/p/{practiceId}/visits/{visitId}/observations',
  middleware: [practiceRoute('readRecords')],
  summary: "A visit's vital signs",
  description: 'Every reading of the visit, oldest first, each with who measured it.',
  request: { params: VisitPath, headers: PracticeHeaders },
  responses: {
    200: { description: "The visit's readings", content: { 'application/json': { schema: Observations } } },
    ...notFound,
    ...refusals,
  },
})

export const lastWeightRoute = createRoute({
  method: 'get',
  path: '/api/p/{practiceId}/patients/{patientId}/last-weight',
  middleware: [practiceRoute('readRecords')],
  summary: "A patient's last weight",
  description:
    "The newest weight reading across the patient's visits, with when it was taken; a cancelled visit's readings do not count, nor those of the visit named in `excludingVisit`. Null when the patient has never been weighed.",
  request: { params: PatientPath, query: LastWeightQuery, headers: PracticeHeaders },
  responses: {
    200: { description: 'The last weight', content: { 'application/json': { schema: LastWeight } } },
    ...refusals,
  },
})

const asJson = ({ occurredAt, ...observation }: ObservationRow) => ({
  ...observation,
  occurredAt: occurredAt.toISOString(),
})

export const putObservation: RouteHandler<typeof recordObservationRoute, Env> = async (c) => {
  const { visitId, observationId } = c.req.valid('param')
  const outcome = await recordObservation({ id: observationId, encounterId: visitId, ...c.req.valid('json') })
  switch (outcome.status) {
    case 'missing':
      return problem(c, 404, 'No such visit')
    case 'taken':
      return problem(c, 409, "The reading id is another visit's reading")
    case 'recorded':
    case 'existing':
      return c.json(asJson(outcome.observation), 200)
  }
}

export const getVisitObservations: RouteHandler<typeof visitObservationsRoute, Env> = async (c) => {
  const observations = await visitObservations(c.req.valid('param').visitId)
  if (!observations) return problem(c, 404, 'No such visit')
  return c.json({ observations: observations.map(asJson) }, 200)
}

export const getLastWeight: RouteHandler<typeof lastWeightRoute, Env> = async (c) => {
  const weight = await lastWeight(c.req.valid('param').patientId, c.req.valid('query').excludingVisit)
  return c.json({ lastWeight: weight ? asJson(weight) : null }, 200)
}
