import { type Action, can, LOCATION_HEADER, parseRoles, type StaffRole } from '@vetora/contracts'
import { and, eq } from 'drizzle-orm'
import type { MiddlewareHandler } from 'hono'
import { auth } from '../platform/auth/auth.js'
import { member } from '../platform/db/control-schema.js'
import { ruleOf } from '../platform/db/errors.js'
import { db } from '../platform/db/index.js'
import { location } from '../platform/db/platform-tables.js'
import { inPractice } from '../platform/db/practice-transaction.js'
import { log as baseLog } from '../platform/log.js'
import { isBehind, registeredPractice } from '../platform/practice-registry.js'
import { problem, ruleProblem } from '../platform/problem.js'
import { withPracticeContext } from '../platform/request-context.js'
import type { Env } from './env.js'

/**
 * The request context of every route under /api/p/:practiceId (spec #18, "The request context"; spec 0001, "Tenancy
 * and data topology"), the route's own middleware, so each route declares the action it performs where it is
 * declared. In order, each answering before anything of the practice is read: the session (401), the membership and
 * its roles from control.member (403), the registry row through its cache (403 when the practice is not active, 503
 * when its schema is behind this code), the location header (400 when missing), the route's action against the
 * permission matrix (403). Then one transaction in the practice as the actor: the location is checked against the
 * practice's active locations first (400), and the request's validation and handler run inside it with
 * `{practice, location, actor, db, log}` in the request context. An answer of 400 or more rolls the transaction back;
 * a rule the database refuses at a statement or at COMMIT answers 409 naming its `vetora.*` code (ruleProblem()).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** What every practice route may answer before its handler runs, for its OpenAPI declaration's `responses`. */
export const refusals = {
  400: { description: 'Validation failed, or no location header or one not of this practice (problem details)' },
  401: { description: 'No session (problem details)' },
  403: { description: 'Not a member, a practice not active, or an action the roles may not perform (problem details)' },
  503: { description: 'The practice is being updated (problem details)' },
} as const

/** Thrown inside the transaction to roll it back once the handler has answered with a refusal or an error. */
class RollBack extends Error {}

/** Thrown inside the transaction when the location header names no active location of the practice: a 400. */
class ForeignLocation extends Error {}

/** The staff roles a person holds in a practice, from their membership; none when they are not a member. */
async function rolesIn(practiceId: string, userId: string): Promise<StaffRole[]> {
  const [membership] = await db()
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, practiceId), eq(member.userId, userId)))
  return membership ? parseRoles(membership.role) : []
}

/** Who acts (IN-1): the session's person, with their roles (spec #18). PIN switching (feature 15) changes this function only. */
function actorOf(userId: string, roles: readonly StaffRole[]) {
  return { id: userId, roles }
}

/** The request context of a practice route that performs `action` (spec #18, "Contracts": the permission matrix). */
export function practiceRoute(action: Action): MiddlewareHandler<Env> {
  return async (c, next) => {
    const session = await auth().api.getSession({ headers: c.req.raw.headers })
    if (!session) return problem(c, 401, 'Not signed in')
    const practiceId = c.req.param('practiceId') ?? ''
    const roles = UUID.test(practiceId) ? await rolesIn(practiceId, session.user.id) : []
    if (roles.length === 0) return problem(c, 403, 'Not a member of this practice')
    const registered = await registeredPractice(practiceId)
    if (registered?.status !== 'active') return problem(c, 403, 'No active practice')
    if (isBehind(registered)) return problem(c, 503, 'The practice is being updated')
    const locationId = c.req.header(LOCATION_HEADER) ?? ''
    if (!UUID.test(locationId)) return problem(c, 400, 'A location is required')
    const actor = actorOf(session.user.id, roles)
    if (!can(actor.roles, action)) return problem(c, 403, 'Not permitted for these roles')

    const requestId = c.get('requestId')
    try {
      await inPractice(registered, { actorId: actor.id, requestId }, async (tx) => {
        const [here] = await tx
          .select({ id: location.id })
          .from(location)
          .where(and(eq(location.id, locationId), eq(location.active, true)))
        if (!here) throw new ForeignLocation()
        const context = {
          practice: { id: registered.id, slug: registered.slug },
          location: { id: here.id },
          actor,
          db: tx,
          log: baseLog.child({ requestId, practiceId }),
        }
        await withPracticeContext(context, () => next())
        if (c.error || c.res.status >= 400) throw new RollBack()
      })
    } catch (error) {
      if (error instanceof ForeignLocation) return problem(c, 400, 'Not an active location of this practice')
      if (error instanceof RollBack) return
      // A deferred check fails at COMMIT, after the handler answered: its answer becomes the refusal.
      const rule = ruleOf(error)
      if (!rule) throw error
      c.res = ruleProblem(c, rule)
    }
  }
}
