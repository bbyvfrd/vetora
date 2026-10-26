import { AsyncLocalStorage } from 'node:async_hooks'
import { drizzleAdapter } from '@better-auth/drizzle-adapter/relations-v2'
import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { createAccessControl } from 'better-auth/plugins/access'
import { admin } from 'better-auth/plugins/admin'
import { organization } from 'better-auth/plugins/organization'
import { username } from 'better-auth/plugins/username'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { loadConfig } from '../config.js'
import * as control from '../db/control-schema.js'
import { LANG_CODES } from '../db/domains.js'
import { db } from '../db/index.js'
import { STAFF_ROLES, type StaffRole } from '../db/platform-tables.js'
import { uuidv7 } from '../ids.js'
import { log } from '../log.js'
import { MAX_USERNAME_LENGTH, USERNAME } from './names.js'

const authLog = log.child({ source: 'better-auth' })

/**
 * Better Auth 1.7.12 as spec #18 configures it ("Identity and access"; the spike's "What ran",
 * docs/research/2026-10-26-better-auth-spike.md): the relations v2 Drizzle adapter over db(), the pooled vetora_app
 * connection, with the hand written control tables (control-schema.ts), every multi step write in one transaction,
 * joins off; UUID v7 ids from the app; username sign in as `handle@practice-code`; the admin plugin for server side
 * createUser only; the organization plugin with the five staff roles, its organizations created by provisioning alone
 * with the registry's id; no sign up; sessions of a fixed 12 hours. Only three of its routes are reachable over HTTP
 * (src/http/auth.ts); the commands call its server side API.
 */

/** Where Better Auth's routes live; src/http/auth.ts mounts the three allowed ones under it. */
export const AUTH_BASE_PATH = '/api/auth'

/** A session ends this long after sign in, whatever happens in between (spec #18; story 8). */
export const SESSION_HOURS = 12

/** The shortest password a login may have (spec #18). Better Auth's admin createUser does not check it: logins.ts does. */
export const MIN_PASSWORD_LENGTH = 10

/**
 * The organization plugin's own permissions, which no allowed route checks (its routes are unreachable, and vetora's
 * matrix lives in @vetora/contracts); the manager holds the member and invitation rights a staff screen would use.
 */
const ac = createAccessControl({
  organization: ['update', 'delete'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  team: ['create', 'update', 'delete'],
  ac: ['create', 'read', 'update', 'delete'],
})

/** The five staff roles (docs/domain.md §3) and nothing of the plugin's owner, admin and member. */
const roles = Object.fromEntries(
  STAFF_ROLES.map((role) => [
    role,
    role === 'manager'
      ? ac.newRole({
          organization: ['update'],
          member: ['create', 'update', 'delete'],
          invitation: ['create', 'cancel'],
        })
      : ac.newRole({}),
  ]),
) as Record<StaffRole, ReturnType<typeof ac.newRole>>

/** The adapter's models, by the names Better Auth looks them up by. */
export const authTables = {
  user: control.user,
  session: control.session,
  account: control.account,
  verification: control.verification,
  organization: control.organization,
  member: control.member,
  invitation: control.invitation,
  rateLimit: control.rateLimit,
}

/**
 * An id fixed for one model during one call (`withPinnedId`): the scope is the async context, so concurrent requests
 * never see each other's pin (the spike's module state pin was for a driver alone).
 */
const pinnedIds = new AsyncLocalStorage<{ model: string; id: string }>()

/** Run `create` with the next row Better Auth writes for `model` taking `id` instead of a fresh UUID v7. */
export function withPinnedId<T>(model: 'user', id: string, create: () => Promise<T>): Promise<T> {
  return pinnedIds.run({ model, id }, create)
}

/**
 * The instance as configured, over the given tables: the committed ones, which `auth()` and the CLI's check use, or a
 * drifted set the check must refuse (schema-check.fixture.ts).
 */
export function createAuth(tables: typeof authTables = authTables) {
  const config = loadConfig()
  return betterAuth({
    appName: 'vetora',
    baseURL: config.PUBLIC_ORIGIN,
    basePath: AUTH_BASE_PATH,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [config.PUBLIC_ORIGIN],
    telemetry: { enabled: false },
    // Better Auth's own lines ("Invalid password", "User not found") go through the API's logger as JSON, its message
    // alone: the arguments some lines carry (a URL, an error with its request) never reach a log (spec 0001, Logs).
    logger: {
      level: 'debug',
      log: (level, message) => authLog[level](message),
    },
    // schemaName steers only the CLI's generate, the reference schema diffed against control-schema.ts on a bump.
    database: drizzleAdapter(db(), { provider: 'pg', schema: tables, schemaName: 'control', transaction: true }),
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: MIN_PASSWORD_LENGTH },
    user: {
      additionalFields: {
        // The array type names the values but validates nothing, hence the zod validator; the column's check holds it too.
        language: { type: [...LANG_CODES], required: true, validator: { input: z.enum(LANG_CODES) } },
      },
    },
    session: {
      expiresIn: SESSION_HOURS * 60 * 60,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    // On in production only (Better Auth's default) with its default rules, which #20 sets; stored in control.rate_limit
    // so every API container counts the same requests.
    rateLimit: { storage: 'database' },
    advanced: {
      database: {
        generateId: ({ model }) => {
          const pinned = pinnedIds.getStore()
          return pinned?.model === model ? pinned.id : uuidv7()
        },
      },
      // kamal-proxy sets x-forwarded-for to the client (forward_headers: false), so the limiter counts per client
      // rather than in one bucket for everyone (the spike's finding 11).
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
    },
    plugins: [
      username({
        maxUsernameLength: MAX_USERNAME_LENGTH,
        usernameValidator: (value) => USERNAME.test(value),
        immutableUsername: true,
      }),
      // Server side createUser with no session (the spike's finding 6); no platform admin login exists yet.
      admin({ adminRoles: ['admin'], defaultRole: 'staff' }),
      organization({
        ac,
        roles,
        creatorRole: 'manager',
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
        organizationHooks: {
          // Practice id = organization id (spec 0001, "Tenancy"): the id comes from the registry row of the practice
          // code, and an organization for a code the registry lacks is refused (the foreign key refuses it as well).
          beforeCreateOrganization: async ({ organization: created }) => {
            const [registered] = created.slug
              ? await db()
                  .select({ id: control.practice.id })
                  .from(control.practice)
                  .where(eq(control.practice.slug, created.slug))
              : []
            if (!registered) {
              throw new APIError('BAD_REQUEST', { message: 'No practice is registered with this code' })
            }
            return { data: { ...created, id: registered.id } }
          },
        },
      }),
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>

let instance: Auth | undefined

/** The Better Auth instance, created on first use from the validated configuration (loadConfig()). */
export function auth(): Auth {
  instance ??= createAuth()
  return instance
}
