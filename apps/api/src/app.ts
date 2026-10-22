import { OpenAPIHono } from '@hono/zod-openapi'
import * as Sentry from '@sentry/node'
import { HTTPException } from 'hono/http-exception'
import { type RequestIdVariables, requestId } from 'hono/request-id'
import { healthRoute } from './http/health.js'
import { requestLogger } from './http/middleware.js'
import { checkDatabase } from './platform/db.js'
import { log, scrubError } from './platform/log.js'
import { problem } from './platform/problem.js'

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

type Env = { Variables: RequestIdVariables }

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

app.doc31('/api/openapi.json', openApiInfo)

app.notFound((c) => problem(c, 404, 'Not found'))

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return problem(c, error.status, error.message || 'Request failed')
  }
  scrubError(error)
  log.error({ err: error, requestId: c.get('requestId') }, 'unhandled error')
  Sentry.captureException(error)
  return problem(c, 500, 'Internal server error')
})
