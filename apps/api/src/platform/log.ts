import { pino } from 'pino'

/**
 * JSON logs with no personal data (spec 0001, "Logs, uptime, metrics").
 * Request bodies are never logged; headers that carry credentials are redacted.
 */
export const log = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  base: { service: 'api', env: process.env['APP_ENV'] ?? 'local' },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token', '*.secret'],
    censor: '[redacted]',
  },
})

/**
 * A Postgres error's `detail`, `hint`, and `where` can contain the conflicting value
 * (spec 0001, "API conventions"); drop them before the error is logged or reported.
 */
export function scrubError(error: unknown): unknown {
  if (error && typeof error === 'object') {
    for (const key of ['detail', 'hint', 'where', 'internalQuery'] as const) {
      if (key in error) delete (error as Record<string, unknown>)[key]
    }
  }
  return error
}
