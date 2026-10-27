import { sql } from 'drizzle-orm'
import { boolean, check, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { currencyCode, minorUnits, sqlList } from '../../platform/db/domains.js'
import { standardColumns } from '../../platform/db/platform-tables.js'

/**
 * The Inventory tables (spec 0002, "Data model sketch": Inventory): `service` (slice 1, #25), `product`,
 * `stock_location`, `lot`, `stock_movement` with `apply_stock_movement()` (slice 2), `goods_receipt`,
 * `goods_receipt_line`, `stock_count`, `stock_count_line`, `stock_transfer` (slice 4).
 */

/** What a service is, for the price list's grouping (spec 0002's sketch). */
export const SERVICE_CATEGORIES = ['consultation', 'procedure', 'lab', 'grooming', 'boarding', 'other'] as const

/** The consent a service needs before its line is issued (slice 8 checks it; nothing sets it yet). */
export const CONSENT_SCOPES = ['surgery', 'anaesthesia', 'euthanasia', 'procedure'] as const

/**
 * A service on the price list (docs/domain.md §7.3: Service), mutable: the clinic edits it and retires it with
 * `active`, never deleting it (IN-6). Loaded by `load-services` until feature 15's screen. Its price is integer minor
 * units with its currency (IN-4); an invoice line snapshots the names and the price when it is added, so a later price
 * change touches no line (spec 0002, "Value sourcing": Add an invoice line).
 */
export const service = pgTable(
  'service',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    nameAz: text('name_az'),
    nameRu: text('name_ru'),
    nameEn: text('name_en'),
    category: text('category', { enum: SERVICE_CATEGORIES }).notNull(),
    priceMinor: minorUnits('price_minor').notNull(),
    /** drizzle-kit leaves a custom type's default unquoted: the sql default (docs/database.md, "Migrations"). */
    currency: currencyCode('currency').notNull().default(sql`'AZN'`),
    defaultDurationMin: integer('default_duration_min'),
    requiresConsentScope: text('requires_consent_scope', { enum: CONSENT_SCOPES }),
    active: boolean('active').notNull().default(true),
    ...standardColumns(),
  },
  (table) => [
    check('service_name_check', sql`coalesce(${table.nameAz}, ${table.nameRu}, ${table.nameEn}) is not null`),
    check('service_category_check', sql`${table.category} in (${sqlList(SERVICE_CATEGORIES)})`),
    check(
      'service_consent_scope_check',
      sql`${table.requiresConsentScope} is null or ${table.requiresConsentScope} in (${sqlList(CONSENT_SCOPES)})`,
    ),
    check('service_price_check', sql`${table.priceMinor} >= 0`),
    check('service_duration_check', sql`${table.defaultDurationMin} is null or ${table.defaultDurationMin} > 0`),
  ],
)
