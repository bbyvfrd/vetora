import { createRoute, type RouteHandler } from '@hono/zod-openapi'
import {
  PracticeHeaders,
  PracticePath,
  Registration,
  Visit,
  VisitChangeHeaders,
  VisitNote,
  VisitPath,
  VisitStarted,
  VisitsToday,
  VisitVersion,
  versionOfTag,
  versionTag,
} from '@vetora/contracts'
import type { Context } from 'hono'
import { clientBalance, invoiceStates } from '../modules/billing/index.js'
import { clientCard, clientNames } from '../modules/client/index.js'
import {
  type ChangeOutcome,
  cancelEncounter,
  completeEncounter,
  readEncounter,
  saveNote,
  startEncounter,
  visitsToday,
} from '../modules/clinical-record/index.js'
import { patientCard, patientNames } from '../modules/patient/index.js'
import { problem } from '../platform/problem.js'
import type { Env } from './env.js'
import { practiceRoute, refusals } from './practice-context.js'
import { register } from './registration.js'

/**
 * A visit and its note (#22; spec #18, "Visit and money behaviour": Start visit, the draft note's versioned save,
 * Complete visit, Cancel visit, Visits today), each behind the request context with the action it performs: a vet
 * starts, completes and cancels; an assistant or a vet writes the note; every role but the groomer reads. Starting
 * carries the visit's UUID v7, so a retry changes nothing; every later change carries the version in `If-Match` and
 * answers 412 when it is stale. What the database refuses (the finalise trigger, the freeze) answers 409 naming its
 * rule, through the request context.
 */

const changeRefusals = {
  404: { description: 'No such visit, or a cancelled one (problem details)' },
  409: { description: 'Refused by a rule of the record: completed, or not complete (problem details naming the rule)' },
  412: { description: 'Another change came first: the version is stale (problem details)' },
} as const

export const startVisitRoute = createRoute({
  method: 'put',
  path: '/api/p/{practiceId}/visits/{visitId}',
  middleware: [practiceRoute('conductEncounter')],
  summary: 'Start a visit',
  description:
    "Writes what is new of the client and the patient, then the draft visit, in one transaction: the actor is its veterinarian, the patient's owner its client and reporter, the request's location its place, now its start. The visit id is a UUID v7 the client generates: the same request again changes nothing.",
  request: {
    params: VisitPath,
    headers: PracticeHeaders,
    body: { content: { 'application/json': { schema: Registration } }, required: true },
  },
  responses: {
    200: { description: 'Started', content: { 'application/json': { schema: VisitStarted } } },
    404: { description: 'No such client, species or breed (problem details)' },
    409: {
      description:
        "The microchip is another patient's, the patient is not this client's, or the visit id is another patient's visit (problem details)",
    },
    ...refusals,
  },
})

export const visitRoute = createRoute({
  method: 'get',
  path: '/api/p/{practiceId}/visits/{visitId}',
  middleware: [practiceRoute('readRecords')],
  summary: 'A visit',
  description:
    "The visit with its note, its veterinarian, and what its patient header shows of the patient and the owner, the owner's balance across visits included.",
  request: { params: VisitPath, headers: PracticeHeaders },
  responses: {
    200: { description: 'The visit', content: { 'application/json': { schema: Visit } } },
    404: { description: 'No such visit, or a cancelled one (problem details)' },
    ...refusals,
  },
})

export const noteRoute = createRoute({
  method: 'put',
  path: '/api/p/{practiceId}/visits/{visitId}/note',
  middleware: [practiceRoute('recordVitalSignsAndNote')],
  summary: "Save a draft visit's note",
  description: 'Replaces the six sections of the note, against the version in If-Match; answers the new version.',
  request: {
    params: VisitPath,
    headers: VisitChangeHeaders,
    body: { content: { 'application/json': { schema: VisitNote } }, required: true },
  },
  responses: {
    200: { description: 'Saved', content: { 'application/json': { schema: VisitVersion } } },
    ...changeRefusals,
    ...refusals,
  },
})

export const completeRoute = createRoute({
  method: 'post',
  path: '/api/p/{practiceId}/visits/{visitId}/complete',
  middleware: [practiceRoute('conductEncounter')],
  summary: 'Complete a visit',
  description:
    "Completes the visit against the version in If-Match, in one transaction: the actor's care relationship with the patient found and extended, or created, lapsing the practice's lapse months from now; then the visit finalised by the actor, which freezes it. A blank reason for visit is refused.",
  request: { params: VisitPath, headers: VisitChangeHeaders },
  responses: {
    200: { description: 'Completed', content: { 'application/json': { schema: VisitVersion } } },
    ...changeRefusals,
    ...refusals,
  },
})

export const cancelRoute = createRoute({
  method: 'post',
  path: '/api/p/{practiceId}/visits/{visitId}/cancel',
  middleware: [practiceRoute('conductEncounter')],
  summary: 'Cancel a draft visit',
  description:
    'Discards a draft visit opened by mistake, against the version in If-Match, with its draft invoice; a completed one is refused, and so is one whose invoice is issued.',
  request: { params: VisitPath, headers: VisitChangeHeaders },
  responses: {
    200: { description: 'Cancelled', content: { 'application/json': { schema: VisitVersion } } },
    ...changeRefusals,
    409: {
      description:
        "Refused by a rule of the record (problem details naming the rule: a completed visit), or the visit's invoice is issued",
    },
    ...refusals,
  },
})

export const visitsTodayRoute = createRoute({
  method: 'get',
  path: '/api/p/{practiceId}/visits',
  middleware: [practiceRoute('readRecords')],
  summary: 'Visits today',
  description:
    "The visits started today at the request's location, the day in the practice's time zone, newest first, each with its invoice's state; cancelled ones are left out.",
  request: { params: PracticePath, headers: PracticeHeaders },
  responses: {
    200: { description: "The day's visits", content: { 'application/json': { schema: VisitsToday } } },
    ...refusals,
  },
})

export const putVisit: RouteHandler<typeof startVisitRoute, Env> = async (c) => {
  const { visitId } = c.req.valid('param')
  const registered = await register(c, c.req.valid('json'))
  if ('refusal' in registered) return registered.refusal
  const outcome = await startEncounter({ id: visitId, ...registered })
  if (outcome === 'taken') return problem(c, 409, "The visit id is another patient's visit")
  return c.json({ ...registered, visitId }, 200)
}

export const getVisit: RouteHandler<typeof visitRoute, Env> = async (c) => {
  const visit = await readEncounter(c.req.valid('param').visitId)
  if (!visit) return problem(c, 404, 'No such visit')
  const [patient, owner, balance] = await Promise.all([
    patientCard(visit.patientId),
    clientCard(visit.clientId),
    clientBalance(visit.clientId),
  ])
  // The keys hold the two rows, which are never deleted (IN-6).
  if (!patient || !owner) throw new Error('a visit names a patient or a client that is not there')
  const { patientId: _patient, clientId: _client, ...rest } = visit
  c.header('etag', versionTag(visit.version))
  return c.json(
    {
      ...rest,
      startedAt: visit.startedAt.toISOString(),
      finalisedAt: visit.finalisedAt?.toISOString() ?? null,
      patient,
      owner: { ...owner, balance: balance && { ...balance, amountMinor: Number(balance.amountMinor) } },
    },
    200,
  )
}

/** The answer to a change against a version: the new version, 412 when it was stale, 404 when there is no visit. */
function changed(c: Context<Env>, outcome: ChangeOutcome) {
  switch (outcome.status) {
    case 'missing':
      return problem(c, 404, 'No such visit')
    case 'stale':
      return problem(c, 412, 'The visit changed since it was read')
    case 'changed':
      c.header('etag', versionTag(outcome.version))
      return c.json({ version: outcome.version }, 200)
  }
}

export const putNote: RouteHandler<typeof noteRoute, Env> = async (c) => {
  const { visitId } = c.req.valid('param')
  const version = versionOfTag(c.req.valid('header')['if-match'])
  return changed(c, await saveNote(visitId, version, c.req.valid('json')))
}

export const postComplete: RouteHandler<typeof completeRoute, Env> = async (c) => {
  const { visitId } = c.req.valid('param')
  return changed(c, await completeEncounter(visitId, versionOfTag(c.req.valid('header')['if-match'])))
}

export const postCancel: RouteHandler<typeof cancelRoute, Env> = async (c) => {
  const { visitId } = c.req.valid('param')
  const outcome = await cancelEncounter(visitId, versionOfTag(c.req.valid('header')['if-match']))
  // The answer rolls the request back, the visit with it (practice-routes.md, "The answer decides the transaction").
  if (outcome.status === 'invoiced') return problem(c, 409, "The visit's invoice is issued")
  return changed(c, outcome)
}

export const getVisitsToday: RouteHandler<typeof visitsTodayRoute, Env> = async (c) => {
  const { day, visits } = await visitsToday()
  const ids = visits.map((visit) => visit.id)
  const [patients, clients, invoices] = await Promise.all([
    patientNames(visits.map((visit) => visit.patientId)),
    clientNames(visits.map((visit) => visit.clientId)),
    invoiceStates(ids),
  ])
  return c.json(
    {
      day,
      visits: visits.map(({ patientId, clientId, startedAt, ...visit }) => {
        const client = clients.get(clientId)
        const name = patients.get(patientId)
        // The keys hold both rows, which are never deleted (IN-6).
        if (!client || name === undefined) throw new Error('a visit names a patient or a client that is not there')
        return {
          ...visit,
          startedAt: startedAt.toISOString(),
          patient: { id: patientId, name },
          client,
          invoice: invoices.get(visit.id) ?? 'none',
        }
      }),
    },
    200,
  )
}
