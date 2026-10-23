import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { currencyCode, langCode } from './domains.js'

/**
 * The platform tables of a practice schema (spec 0002, "Data model sketch": Platform and settings): declared without a
 * schema, because the practice set is applied to every p_<id> schema with search_path set to it (spec 0002,
 * "Interface surface"). Their classes are registered in table-classes.ts. Every table but audit_event spreads the
 * standard columns and carries the two shared triggers, set_updated_at and audit_row, attached in the migration
 * (drizzle-kit models tables, not triggers). Every export is tagged `@public`: a module's schema.ts builds on these
 * (standardColumns(), a reference to staff_member or location), and Biome's noPrivateImports lets a module import
 * nothing from src/platform/ without the tag (biome.jsonc, package visibility inside src/modules/).
 */

/**
 * The standard columns of every practice table (spec 0002, "Conventions": Standard columns): the clock and the actor
 * at creation and at the last update, and the version an update bumps by one (optimistic concurrency, 412 per spec
 * 0001). The set_updated_at trigger fills all five from the database clock and app.actor_id, never from the row the
 * client sent (IN-1); the actor columns are nullable because a migration writes as vetora_migrator with no actor.
 * The two staff_member references are not indexed, a deliberate exception to spec 0002's "foreign keys are indexed"
 * (Keys): staff_member.id is never deleted or retyped (IN-6), who wrote what is read from audit_event's actor index,
 * and an index on updated_by would defeat HOT updates on every row a different person touches.
 * @public
 */
export const standardColumns = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by').references((): AnyPgColumn => staffMember.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').references((): AnyPgColumn => staffMember.id),
  version: integer('version').notNull().default(1),
})

/**
 * The one settings row's constant id (the nil UUID): the check below keeps the table to exactly one row.
 * @public
 */
export const PRACTICE_SETTINGS_ID = '00000000-0000-0000-0000-000000000000'

/**
 * The practice's settings, exactly one row (spec 0002, "Platform and settings"), seeded by provisioning from its
 * arguments.
 * @public
 */
export const practiceSettings = pgTable(
  'practice_settings',
  {
    id: uuid('id').primaryKey().default(PRACTICE_SETTINGS_ID),
    legalName: text('legal_name').notNull(),
    displayName: text('display_name').notNull(),
    address: text('address'),
    phone: text('phone'),
    taxId: text('tax_id'),
    /** Instants are stored in UTC and shown in this zone (docs/domain.md §10). */
    timeZone: text('time_zone').notNull().default('Asia/Baku'),
    /** IN-4: the practice's currency, AZN for now. The two sql defaults: drizzle-kit leaves a custom type's default unquoted. */
    currency: currencyCode('currency').notNull().default(sql`'AZN'`),
    languages: langCode('languages').array().notNull().default(sql`'{az,ru}'`),
    defaultLanguage: langCode('default_language').notNull(),
    careRelationshipLapseMonths: integer('care_relationship_lapse_months').notNull().default(12),
    /** AC-13: the window assert_backdate_limit() measures occurred_at against; the check below keeps it a number of hours. */
    backdateLimitHours: integer('backdate_limit_hours').notNull().default(24),
    delegationEnabled: boolean('delegation_enabled').notNull().default(true),
    /** Set once: the set_once('only', 'go_live_at') trigger of the rules migration lets it go from null to a value once. */
    goLiveAt: timestamp('go_live_at', { withTimezone: true }),
    ...standardColumns(),
  },
  (table) => [
    check('practice_settings_single_row', sql`${table.id} = ${sql.raw(`'${PRACTICE_SETTINGS_ID}'`)}`),
    check('practice_settings_backdate_limit_hours_check', sql`${table.backdateLimitHours} >= 0`),
  ],
)

/**
 * IN-5: a practice has a location from day one; provisioning seeds the default one.
 * @public
 */
export const location = pgTable(
  'location',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    name: text('name').notNull(),
    address: text('address'),
    phone: text('phone'),
    isDefault: boolean('is_default').notNull().default(false),
    active: boolean('active').notNull().default(true),
    ...standardColumns(),
  },
  (table) => [
    /** One default per practice. */
    uniqueIndex('location_default_idx').on(table.isDefault).where(sql`${table.isDefault}`),
  ],
)

/**
 * The staff roles a member can hold (docs/domain.md §3); a label change moves the translations, never the stored value.
 * @public
 */
export const STAFF_ROLES = ['manager', 'veterinarian', 'assistant', 'receptionist', 'groomer'] as const
/** @public */
export type StaffRole = (typeof STAFF_ROLES)[number]

/**
 * The practice's staff, the actor every write names (IN-1): a mirror of the control membership, synced idempotently
 * (slice 1); the first manager's row is written by provisioning as that manager. Stays a platform table: nearly every
 * table references it and it mirrors control, so it is infrastructure, not a module's own table.
 * @public
 */
export const staffMember = pgTable(
  'staff_member',
  {
    /** Equals the control user id (the sign in id, slice 1): never generated here. */
    id: uuid('id').primaryKey(),
    displayName: text('display_name').notNull(),
    roles: text('roles', { enum: STAFF_ROLES }).array().notNull(),
    active: boolean('active').notNull().default(true),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull(),
    ...standardColumns(),
  },
  (table) => [
    /** At least one role, every one of them from the five. */
    check(
      'staff_member_roles_check',
      sql`cardinality(${table.roles}) > 0 and ${table.roles} <@ ${sql.raw(`'{${STAFF_ROLES.join(',')}}'::text[]`)}`,
    ),
  ],
)

const AUDIT_ACTIONS = ['insert', 'update', 'delete'] as const

/**
 * The audit log (IN-1, AC-8): one row per insert, update, and delete on a practice table, written only by the
 * audit_row trigger function, which runs as the owner (the function written class: SELECT only for the practice role).
 * `changed` holds the row an insert wrote, the new values of the columns an update changed, or the row a delete removed,
 * so it carries the personal data of the tables it mirrors and never reaches a log or Sentry (spec 0002, "Security
 * model": Personal data). Never deleted (IN-6).
 * @public
 */
export const auditEvent = pgTable(
  'audit_event',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    tableName: text('table_name').notNull(),
    rowId: uuid('row_id').notNull(),
    action: text('action', { enum: AUDIT_ACTIONS }).notNull(),
    /** The staff member from app.actor_id; null only for a migration, which runs as vetora_migrator with no actor. */
    actorId: uuid('actor_id').references(() => staffMember.id),
    /** `request`, or `migration:<name>` from app.migration on a vetora_migrator session. */
    source: text('source').notNull(),
    /** The database clock, never a client value. */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    changed: jsonb('changed').notNull(),
    /** app.request_id when the request context set it (slice 1). */
    requestId: text('request_id'),
  },
  (table) => [
    check(
      'audit_event_action_check',
      sql`${table.action} in (${sql.raw(AUDIT_ACTIONS.map((action) => `'${action}'`).join(', '))})`,
    ),
    check('audit_event_source_check', sql`${table.source} = 'request' or ${table.source} like 'migration:%'`),
    /** No system actor (IN-1): a row without an actor is a migration's, and says so. */
    check('audit_event_actor_check', sql`${table.actorId} is not null or ${table.source} like 'migration:%'`),
    index('audit_event_row_idx').on(table.tableName, table.rowId),
    index('audit_event_actor_idx').on(table.actorId, table.occurredAt),
  ],
)
