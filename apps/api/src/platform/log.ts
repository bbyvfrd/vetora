import { pino } from 'pino'

/**
 * JSON logs with no personal data (spec 0001, "Logs, uptime, metrics").
 * Request bodies are never logged; headers that carry credentials are redacted.
 */
export const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'api', env: process.env.APP_ENV ?? 'local' },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token', '*.secret'],
    censor: '[redacted]',
  },
})

/** The error and its causes, outermost first; stops after ten levels so a cycle cannot spin. */
function* causeChain(error: unknown): Generator<object> {
  let current = error
  for (let depth = 0; depth < 10 && current && typeof current === 'object'; depth++) {
    yield current
    current = (current as { cause?: unknown }).cause
  }
}

/**
 * A Postgres error's `detail`, `hint`, and `where` can contain the conflicting value
 * (spec 0001, "API conventions"); drop them before the error is logged or reported.
 * Drizzle wraps a failed query in a DrizzleQueryError whose `cause` is the Postgres error, so the
 * whole cause chain is scrubbed.
 */
export function scrubError(error: unknown): unknown {
  for (const level of causeChain(error)) {
    for (const key of ['detail', 'hint', 'where', 'internalQuery'] as const) {
      if (key in level) delete (level as Record<string, unknown>)[key]
    }
  }
  return error
}

/** The innermost cause: the Postgres error inside Drizzle's wrapper, whose `code` and message say what failed. */
export function rootCause(error: unknown): unknown {
  let root = error
  for (const level of causeChain(error)) root = level
  return root
}
