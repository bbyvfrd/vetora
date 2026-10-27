import { OpenAPIHono } from '@hono/zod-openapi'
import * as Sentry from '@sentry/node'
import { HTTPException } from 'hono/http-exception'
import { requestId } from 'hono/request-id'
import { getSession, getSessionRoute, signIn, signInRoute, signOut, signOutRoute } from './http/auth.js'
import type { Env } from './http/env.js'
import { healthRoute } from './http/health.js'
import {
  addLineRoute,
  createInvoiceRoute,
  getServices,
  getVisitInvoice,
  issueRoute,
  postIssue,
  postRemoveLine,
  putInvoice,
  putLine,
  putQuantity,
  quantityRoute,
  removeLineRoute,
  servicesRoute,
  visitInvoiceRoute,
} from './http/invoices.js'
import { getMe, languageRoute, meRoute, putLanguage } from './http/me.js'
import { requestLogger } from './http/middleware.js'
import {
  getLastWeight,
  getVisitObservations,
  lastWeightRoute,
  putObservation,
  recordObservationRoute,
  visitObservationsRoute,
} from './http/observations.js'
import { putPayment, takePaymentRoute } from './http/payments.js'
import {
  breedRoute,
  getSpecies,
  lookUpClients,
  lookupRoute,
  putBreed,
  putRegistration,
  registrationRoute,
  speciesRoute,
} from './http/registration.js'
import {
  cancelRoute,
  completeRoute,
  getVisit,
  getVisitsToday,
  noteRoute,
  postCancel,
  postComplete,
  putNote,
  putVisit,
  startVisitRoute,
  visitRoute,
  visitsTodayRoute,
} from './http/visits.js'
import { ruleOf } from './platform/db/errors.js'
import { checkDatabase } from './platform/db/index.js'
import { log, scrubError } from './platform/log.js'
import { problem, ruleProblem } from './platform/problem.js'

export const version = process.env.KAMAL_VERSION ?? 'dev'

export const openApiInfo = {
  openapi: '3.1.0',
  info: {
    title: 'vetora API',
    version,
    description:
      'The API behind the clinic web app and, later, the pet owner app. Routes are declared with zod schemas from packages/contracts.',
  },
} as const

export const app = new OpenAPIHono<Env>({
  defaultHook: (result, c) => {
    if (!result.success) {
      return problem(c, 400, 'Validation failed', { errors: result.error.issues })
    }
    return undefined
  },
})

app.use('*', requestId())
app.use('*', requestLogger)

/** Liveness for kamal-proxy and the uptime check: cheap, no database (spec 0001, "Runtime and deployment topology"). */
app.get('/up', (c) => c.text('OK'))

app.openapi(healthRoute, async (c) => {
  const database = await checkDatabase()
  if (database !== 'ok') {
    return problem(c, 503, 'Database unavailable')
  }
  return c.json({ status: 'ok' as const, version, database, time: new Date().toISOString() }, 200)
})

// The three Better Auth routes the allowlist lets through (src/http/auth.ts); the rest of /api/auth is the 404 below.
app.openapi(signInRoute, signIn)
app.openapi(signOutRoute, signOut)
app.openapi(getSessionRoute, getSession)

app.openapi(meRoute, getMe)
app.openapi(languageRoute, putLanguage)

// The practice routes, each behind the request context with its action (src/http/practice-context.ts).
app.openapi(speciesRoute, getSpecies)
app.openapi(breedRoute, putBreed)
app.openapi(lookupRoute, lookUpClients)
app.openapi(registrationRoute, putRegistration)
app.openapi(startVisitRoute, putVisit)
app.openapi(visitRoute, getVisit)
app.openapi(noteRoute, putNote)
app.openapi(completeRoute, postComplete)
app.openapi(cancelRoute, postCancel)
app.openapi(visitsTodayRoute, getVisitsToday)
app.openapi(recordObservationRoute, putObservation)
app.openapi(visitObservationsRoute, getVisitObservations)
app.openapi(lastWeightRoute, getLastWeight)
app.openapi(servicesRoute, getServices)
app.openapi(visitInvoiceRoute, getVisitInvoice)
app.openapi(createInvoiceRoute, putInvoice)
app.openapi(addLineRoute, putLine)
app.openapi(quantityRoute, putQuantity)
app.openapi(removeLineRoute, postRemoveLine)
app.openapi(issueRoute, postIssue)
app.openapi(takePaymentRoute, putPayment)

app.doc31('/api/openapi.json', openApiInfo)

app.notFound((c) => problem(c, 404, 'Not found'))

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return problem(c, error.status, error.message || 'Request failed')
  }
  // A rule the database enforces refused the request: an answer, not a fault (the request context rolls it back).
  const rule = ruleOf(error)
  if (rule) return ruleProblem(c, rule)
  scrubError(error)
  log.error({ err: error, requestId: c.get('requestId') }, 'unhandled error')
  Sentry.captureException(error)
  return problem(c, 500, 'Internal server error')
})
