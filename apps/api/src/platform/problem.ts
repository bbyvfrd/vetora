import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { RuleName } from './db/errors.js'

/** Problem details JSON (RFC 9457), the one error shape every client relies on (spec 0001, "API conventions"). */
export type Problem = {
  type: string
  title: string
  status: number
  detail?: string
  instance?: string
  requestId?: string
  errors?: unknown
  /** An extension member: the `vetora.*` rule the database refused the request by (src/platform/db/errors.ts). */
  code?: string
}

export function problem(
  c: Context,
  status: ContentfulStatusCode,
  title: string,
  extra: Partial<Pick<Problem, 'detail' | 'errors' | 'type' | 'code'>> = {},
) {
  const body: Problem = {
    type: extra.type ?? 'about:blank',
    title,
    status,
    instance: c.req.path,
    ...(c.get('requestId') ? { requestId: String(c.get('requestId')) } : {}),
    ...(extra.detail ? { detail: extra.detail } : {}),
    ...(extra.errors ? { errors: extra.errors } : {}),
    ...(extra.code ? { code: extra.code } : {}),
  }
  return c.json(body, status, { 'content-type': 'application/problem+json' })
}

/**
 * A request the database refused by one of its rules, at a statement or at COMMIT for a deferred check (spec #18,
 * "The request context"): 409, naming the rule; the Postgres message, detail, hint and where never leave.
 */
export function ruleProblem(c: Context, rule: RuleName) {
  return problem(c, 409, 'Refused by a rule of the record', { code: rule })
}
