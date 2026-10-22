import type { MiddlewareHandler } from 'hono'
import { log } from '../platform/log.js'

/** One line per request: method, path, status, duration, request id. Never a body, never a query string. */
export const requestLogger: MiddlewareHandler = async (c, next) => {
  const started = performance.now()
  await next()
  if (c.req.path === '/up') return
  log.info(
    {
      requestId: c.get('requestId'),
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - started),
    },
    'request',
  )
}
