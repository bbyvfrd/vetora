import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

/** Problem details JSON (RFC 9457), the one error shape every client relies on (spec 0001, "API conventions"). */
export type Problem = {
  type: string
  title: string
  status: number
  detail?: string
  instance?: string
  requestId?: string
  errors?: unknown
}

export function problem(
  c: Context,
  status: ContentfulStatusCode,
  title: string,
  extra: Partial<Pick<Problem, 'detail' | 'errors' | 'type'>> = {},
) {
  const body: Problem = {
    type: extra.type ?? 'about:blank',
    title,
    status,
    instance: c.req.path,
    ...(c.get('requestId') ? { requestId: String(c.get('requestId')) } : {}),
    ...(extra.detail ? { detail: extra.detail } : {}),
    ...(extra.errors ? { errors: extra.errors } : {}),
  }
  return c.json(body, status, { 'content-type': 'application/problem+json' })
}
