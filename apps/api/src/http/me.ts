import { createRoute, type RouteHandler } from '@hono/zod-openapi'
import { LanguageUpdate, Me, parseRoles } from '@vetora/contracts'
import { asc, desc, eq } from 'drizzle-orm'
import { auth } from '../platform/auth/auth.js'
import { member, practice, user } from '../platform/db/control-schema.js'
import { db } from '../platform/db/index.js'
import { location, practiceSettings } from '../platform/db/platform-tables.js'
import { inPractice } from '../platform/db/practice-transaction.js'
import { problem } from '../platform/problem.js'
import type { Env } from './env.js'

/**
 * Who is signed in (spec #18, "Identity and access"; stories 12 and 27): the web app's first call after sign in, and
 * the route that saves a person's language to their login. vetora's own routes, not Better Auth's: the practice and
 * the roles come from the membership, never from Better Auth's active organization (the spike's finding 12).
 */

export const meRoute = createRoute({
  method: 'get',
  path: '/api/me',
  summary: 'Who is signed in',
  description:
    'The signed in person, their practice with their roles, and its active locations with the default marked.',
  responses: {
    200: { description: 'The signed in person', content: { 'application/json': { schema: Me } } },
    401: { description: 'No session (problem details)' },
    403: { description: 'The login has no active practice (problem details)' },
  },
})

export const languageRoute = createRoute({
  method: 'put',
  path: '/api/me/language',
  summary: "Save the person's language",
  description: 'Saves the interface language to the login, so it follows the person to any computer.',
  request: { body: { content: { 'application/json': { schema: LanguageUpdate } }, required: true } },
  responses: {
    204: { description: 'Saved' },
    400: { description: 'Not one of az, ru and en (problem details)' },
    401: { description: 'No session (problem details)' },
  },
})

export const getMe: RouteHandler<typeof meRoute, Env> = async (c) => {
  const session = await auth().api.getSession({ headers: c.req.raw.headers })
  if (!session) return problem(c, 401, 'Not signed in')
  const [membership] = await db()
    .select({
      practiceId: practice.id,
      code: practice.slug,
      status: practice.status,
      schemaName: practice.schemaName,
      roleName: practice.roleName,
      role: member.role,
    })
    .from(member)
    .innerJoin(practice, eq(practice.id, member.organizationId))
    .where(eq(member.userId, session.user.id))
  // A value the membership's check would refuse is dropped by parseRoles, never trusted.
  const roles = membership ? parseRoles(membership.role) : []
  // Fail closed: no membership, a practice that is not active, or no role among the five.
  if (membership?.status !== 'active' || roles.length === 0) {
    return problem(c, 403, 'No active practice')
  }
  const actor = { actorId: session.user.id, requestId: c.get('requestId') }
  const { settings, locations } = await inPractice(membership, actor, async (tx) => {
    const [row] = await tx
      .select({ name: practiceSettings.displayName, timeZone: practiceSettings.timeZone })
      .from(practiceSettings)
    const rows = await tx
      .select({ id: location.id, name: location.name, isDefault: location.isDefault })
      .from(location)
      .where(eq(location.active, true))
      .orderBy(desc(location.isDefault), asc(location.name))
    return { settings: row, locations: rows }
  })
  if (!settings) return problem(c, 403, 'No active practice')
  const { name, timeZone } = settings
  return c.json(
    {
      id: session.user.id,
      displayName: session.user.name,
      language: session.user.language as Me['language'],
      practice: { id: membership.practiceId, name, code: membership.code, roles, timeZone },
      locations,
    },
    200,
  )
}

export const putLanguage: RouteHandler<typeof languageRoute, Env> = async (c) => {
  const session = await auth().api.getSession({ headers: c.req.raw.headers })
  if (!session) return problem(c, 401, 'Not signed in')
  const { language } = c.req.valid('json')
  await db().update(user).set({ language, updatedAt: new Date() }).where(eq(user.id, session.user.id))
  return c.body(null, 204)
}
