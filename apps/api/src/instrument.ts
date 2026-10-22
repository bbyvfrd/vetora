import * as Sentry from '@sentry/node'

/**
 * Error reporting (spec 0001, "Errors"): only stack traces and internal ids leave.
 * Sentry v11 replaced `sendDefaultPii` with `dataCollection`; every category is off here.
 * Loaded first by index.ts; does nothing without a DSN (local development).
 */
const dsn = process.env['SENTRY_DSN_API']

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env['APP_ENV'] ?? 'local',
    ...(process.env['KAMAL_VERSION'] ? { release: process.env['KAMAL_VERSION'] } : {}),
    tracesSampleRate: 0,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    beforeSend(event) {
      if (event.request) {
        delete event.request.data
        delete event.request.cookies
        delete event.request.headers
        delete event.request.query_string
      }
      delete event.user
      return event
    },
  })
}
