import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { LANG_CODES } from './domains.js'
import { STAFF_ROLES } from './platform-tables.js'

/**
 * The control schema (spec 0002, "Data model sketch": Control schema): the practice registry, routing and status, and
 * the sign in tables Better Auth reads and writes (feature 5, ticket #19). drizzle-kit reads this file through
 * drizzle.control.config.ts and writes the control set to drizzle/control/. The ext schema with its extensions, the
 * unaccent wrapper, and the grants are hand written into the migrations, since drizzle-kit models tables, not
 * functions or grants.
 */
export const control = pgSchema('control')

/** The registry's state machine: a text column with a check, as every fixed value set (spec 0002, "Value sets"). */
const practiceStatuses = ['provisioning', 'active', 'suspended', 'archived'] as const

/** A quoted, comma separated SQL list of fixed values, for a check. */
const sqlList = (values: readonly string[]) => sql.raw(values.map((value) => `'${value}'`).join(', '))

export const practice = control.table(
  'practice',
  {
    /** Equals the sign in organization id (spec 0001, "Tenancy"): a UUID v7 issued by Postgres 18, then given to Better Auth. */
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    /** The practice code staff sign in with (Clinic code on screen; GLOSSARY.md). */
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    /** `p_<id>`, the practice's own schema (spec 0001, "Tenancy and data topology"). */
    schemaName: text('schema_name').notNull().unique(),
    /** `p_<id>_role`, the no login role that holds the schema's grants. */
    roleName: text('role_name').notNull().unique(),
    status: text('status', { enum: practiceStatuses }).notNull().default('provisioning'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('practice_status_check', sql`${table.status} in (${sqlList(practiceStatuses)})`)],
)

/*
 * The sign in tables (spec #18, "Identity and access"): the models Better Auth 1.7.12 declares for the configured
 * plugins (username, admin, organization), written by hand rather than taken from the CLI's generate, which emits text
 * ids and timestamps without a time zone (docs/research/2026-10-26-better-auth-spike.md, finding 4): uuid ids from
 * the app's UUID v7 (src/platform/auth/auth.ts) and foreign keys, timestamptz instants, snake_case columns under the
 * field names Better Auth uses as the TypeScript keys, which are also the model names the adapter looks up. `auth check
 * schema` (CI, beside db:check) proves they hold what Better Auth writes. The two factor table arrives with feature 15
 * (ADR 0008). The sign in lock beside them is vetora's own (#20).
 */

const instant = (name: string) => timestamp(name, { withTimezone: true })

/** A login: one staff member of one practice (Handle and Practice code, GLOSSARY.md), or later the platform admin. */
export const user = control.table(
  'user',
  {
    id: uuid('id').primaryKey(),
    /** The person's display name. */
    name: text('name').notNull(),
    /** A placeholder that cannot receive mail (`handle@code.staff.invalid`): nothing in vetora sends email to staff. */
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: instant('created_at').notNull().defaultNow(),
    updatedAt: instant('updated_at').notNull().defaultNow(),
    /** `handle@practice-code`, lower case (the username plugin normalises it), never changed (immutableUsername). */
    username: text('username').notNull().unique(),
    displayUsername: text('display_username'),
    /** The platform role of the admin plugin: `staff`, or `admin` for the platform admin; never a practice role. */
    role: text('role'),
    banned: boolean('banned').default(false),
    banReason: text('ban_reason'),
    banExpires: instant('ban_expires'),
    /** The person's interface language, which follows them to any computer once they sign in. */
    language: text('language', { enum: LANG_CODES }).notNull(),
  },
  (table) => [check('user_language_check', sql`${table.language} in (${sqlList(LANG_CODES)})`)],
)

/** A signed in session: 12 hours from sign in, never refreshed (src/platform/auth/auth.ts). */
export const session = control.table(
  'session',
  {
    id: uuid('id').primaryKey(),
    expiresAt: instant('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: instant('created_at').notNull().defaultNow(),
    updatedAt: instant('updated_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** The admin plugin's impersonation, which no allowed route reaches. */
    impersonatedBy: uuid('impersonated_by'),
    /** The organization plugin's choice per session; vetora never relies on it (the practice comes from the path). */
    activeOrganizationId: uuid('active_organization_id'),
  },
  (table) => [index('session_user_id_idx').on(table.userId)],
)

/** A login's credential: the scrypt hash of its password (provider `credential`, account id = the user id). */
export const account = control.table(
  'account',
  {
    id: uuid('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: instant('access_token_expires_at'),
    refreshTokenExpiresAt: instant('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: instant('created_at').notNull().defaultNow(),
    updatedAt: instant('updated_at').notNull(),
  },
  (table) => [index('account_user_id_idx').on(table.userId)],
)

/** Better Auth's one time values; empty while vetora has no email flows. */
export const verification = control.table(
  'verification',
  {
    id: uuid('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: instant('expires_at').notNull(),
    createdAt: instant('created_at').notNull().defaultNow(),
    updatedAt: instant('updated_at').notNull().defaultNow(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
)

/**
 * A practice as Better Auth knows it: its id is the registry's (spec 0001, "Tenancy"), which the foreign key holds,
 * and its slug the practice code.
 */
export const organization = control.table('organization', {
  id: uuid('id')
    .primaryKey()
    .references(() => practice.id),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  createdAt: instant('created_at').notNull(),
  metadata: text('metadata'),
})

/**
 * A login's membership of its practice, the source of truth for its roles (spec #18): one row per organization and
 * login, `role` the staff roles joined with commas (Better Auth's own form), mirrored into the practice's staff_member
 * row in the same transaction. No default: the plugin's `member` is not a staff role.
 */
export const member = control.table(
  'member',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdAt: instant('created_at').notNull(),
  },
  (table) => [
    index('member_organization_id_idx').on(table.organizationId),
    index('member_user_id_idx').on(table.userId),
    uniqueIndex('member_organization_user_uidx').on(table.organizationId, table.userId),
    /** One or more of the five staff roles, comma joined, nothing else. */
    check(
      'member_role_check',
      sql`${table.role} <> '' and string_to_array(${table.role}, ',') <@ array[${sqlList(STAFF_ROLES)}]::text[]`,
    ),
  ],
)

/** The organization plugin's invitations; no allowed route writes one (staff come from operator commands). */
export const invitation = control.table(
  'invitation',
  {
    id: uuid('id').primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role'),
    status: text('status').notNull().default('pending'),
    expiresAt: instant('expires_at').notNull(),
    createdAt: instant('created_at').notNull().defaultNow(),
    inviterId: uuid('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('invitation_organization_id_idx').on(table.organizationId),
    index('invitation_email_idx').on(table.email),
  ],
)

/** Better Auth's rate limiter, stored in the database so every API container counts the same requests. */
export const rateLimit = control.table('rate_limit', {
  id: uuid('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
})

/**
 * The per account lock (spec #18, "Identity and access"; #20): one row per username that has sign ins not followed
 * by a success, written by src/platform/auth/sign-in-lock.ts alone. Any username string gets a row, a login's or not,
 * so the lock never tells whether a login exists; a success or `unlock-login` deletes the row.
 */
export const signInLock = control.table('sign_in_lock', {
  /** The username as Better Auth looks it up: as typed, lower cased. */
  username: text('username').primaryKey(),
  /** The attempts since the first failure that have not succeeded, each counted from the moment it starts. */
  failures: integer('failures').notNull(),
  firstFailedAt: instant('first_failed_at').notNull(),
  /** Set by the fifth failure within 15 minutes of the first: no sign in until then. */
  lockedUntil: instant('locked_until'),
})
