import { sql } from 'drizzle-orm'
import { boolean, check, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { currencyCode, langCode } from './domains.js'

/**
 * The platform tables of a practice schema (spec 0002, "Data model sketch": Platform and settings): declared without a
 * schema, because the practice set is applied to every p_<id> schema with search_path set to it (spec 0002,
 * "Interface surface"). Their classes are registered in table-classes.ts. The standard columns (created_by,
 * updated_by, the updated_at trigger, version) arrive with the audit ticket as added columns.
 */

/** The one settings row's constant id (the nil UUID): the check below keeps the table to exactly one row. */
export const PRACTICE_SETTINGS_ID = '00000000-0000-0000-0000-000000000000'

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
    backdateLimitHours: integer('backdate_limit_hours').notNull().default(24),
    delegationEnabled: boolean('delegation_enabled').notNull().default(true),
    /** Set once (the trigger arrives with the rules ticket). */
    goLiveAt: timestamp('go_live_at', { withTimezone: true }),
  },
  (table) => [check('practice_settings_single_row', sql`${table.id} = ${sql.raw(`'${PRACTICE_SETTINGS_ID}'`)}`)],
)

/** IN-5: a practice has a location from day one; provisioning seeds the default one. */
export const location = pgTable(
  'location',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    name: text('name').notNull(),
    address: text('address'),
    phone: text('phone'),
    isDefault: boolean('is_default').notNull().default(false),
    active: boolean('active').notNull().default(true),
  },
  (table) => [
    /** One default per practice. */
    uniqueIndex('location_default_idx').on(table.isDefault).where(sql`${table.isDefault}`),
  ],
)
