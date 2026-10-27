import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { currencyCode, minorUnits, sqlList } from '../../platform/db/domains.js'
import { location, standardColumns } from '../../platform/db/platform-tables.js'

/**
 * The Billing & Payments tables (spec 0002, "Data model sketch": Billing and Payments): `invoice_number_seq`,
 * `invoice`, `invoice_line` and `ledger_entry` with the `client_balance` view and `next_invoice_number()` (#25),
 * `payment` and `payment_allocation` (#26), `fiscal_receipt`, `cash_day_close` (slice 3), `estimate`, `estimate_line`,
 * `estimate_approval` (slice 8). What drizzle-kit does not model is written by hand in the migration: the keys to the
 * Client, Patient, Clinical Record and Inventory modules' tables, the view, the numbering function, the freeze of an
 * issued invoice and its lines, and the deferred check at issue (BL-6). Billing never reads clinical internals (BL-2):
 * an invoice stores the visit, patient and client ids it is given.
 */

/** The one counter row's constant id (the nil UUID), as practice_settings keeps its one row. */
export const INVOICE_NUMBER_SEQ_ID = '00000000-0000-0000-0000-000000000000'

/**
 * The counter invoice numbers come from (spec 0002 names it `invoice_number_seq`): one row, seeded by the migration
 * that creates it, advanced only by `next_invoice_number()` under the row's lock in the issuing transaction. A Postgres
 * sequence would lose the value a rolled back issue took, and the numbers are gapless (spec 0002, "Value sourcing":
 * Issue an invoice). Function written: the practice role reads it and never writes it.
 */
export const invoiceNumberSeq = pgTable(
  'invoice_number_seq',
  {
    id: uuid('id').primaryKey().default(INVOICE_NUMBER_SEQ_ID),
    /** The number the last issued invoice took; 0 before the first. */
    lastValue: bigint('last_value', { mode: 'bigint' }).notNull().default(sql`0`),
    ...standardColumns(),
  },
  (table) => [
    check('invoice_number_seq_single_row', sql`${table.id} = ${sql.raw(`'${INVOICE_NUMBER_SEQ_ID}'`)}`),
    check('invoice_number_seq_last_value_check', sql`${table.lastValue} >= 0`),
  ],
)

/** draft while lines are added; issued (frozen, charged); void (feature 8) and discarded (a cancelled visit's draft) are final. */
export const INVOICE_STATUSES = ['draft', 'issued', 'void', 'discarded'] as const

/**
 * An invoice (docs/domain.md §7.3), location scoped (IN-5) and frozen by status: once issued, void or discarded, the
 * freeze_record() trigger refuses every change, and lock_parent() its lines' (BL-6). Issue gives it the next number
 * and `issued_at` in one statement, and the deferred `assert_invoice()` refuses a commit that leaves an issued invoice
 * without exactly one charge `ledger_entry` equal to its live lines' total, or with no live line. Needs neither a
 * patient nor a visit (BL-1). `client_id`, `patient_id` and `encounter_id` are other modules' tables: plain uuids here,
 * their keys in the migration. One live invoice per visit (the grilling's money cut): a void one leaves room for its
 * replacement. `due_on`, `void_reason`, `replaced_by_invoice_id` (feature 8) and `admission_id`, `boarding_stay_id`,
 * `appointment_id`, `estimate_id` (slices 8, 10, 5) arrive as nullable forward columns with the work that sets them.
 */
export const invoice = pgTable(
  'invoice',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    locationId: uuid('location_id')
      .notNull()
      .references(() => location.id),
    /** Gapless per practice, from next_invoice_number() at issue; null while a draft. */
    number: text('number'),
    clientId: uuid('client_id'),
    patientId: uuid('patient_id'),
    encounterId: uuid('encounter_id'),
    status: text('status', { enum: INVOICE_STATUSES }).notNull().default('draft'),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    currency: currencyCode('currency').notNull().default(sql`'AZN'`),
    ...standardColumns(),
  },
  (table) => [
    check('invoice_status_check', sql`${table.status} in (${sqlList(INVOICE_STATUSES)})`),
    /** Issued and void invoices carry their number and when they were issued; a draft or a discarded one neither. */
    check(
      'invoice_issued_check',
      sql`(${table.status} in ('issued', 'void')) = (${table.issuedAt} is not null) and (${table.issuedAt} is null) = (${table.number} is null)`,
    ),
    uniqueIndex('invoice_number_idx').on(table.number),
    uniqueIndex('invoice_encounter_live_idx').on(table.encounterId).where(sql`${table.status} in ('draft', 'issued')`),
    index('invoice_location_idx').on(table.locationId),
    index('invoice_client_idx').on(table.clientId),
    index('invoice_patient_idx').on(table.patientId),
    index('invoice_encounter_idx').on(table.encounterId),
  ],
)

/** What a line charges for (spec 0002's sketch); service lines alone in feature 5, the rest arrive with their slices. */
export const INVOICE_LINE_KINDS = [
  'service',
  'dispense',
  'sale',
  'administration',
  'boarding_night',
  'lab_test',
  'other',
] as const

/**
 * A line of an invoice (docs/domain.md §7.3: InvoiceLine), frozen with its invoice (lock_parent()). Its references and
 * snapshots are fixed at insert, so while the invoice is a draft only `quantity`, `total_minor` and `sort` change and
 * `removed_at` is set once (set_once() with its `free:` columns); a removed line is excluded from totals. The names
 * and the unit price are snapshots of the service at the time (spec 0002, "Value sourcing": Add an invoice line), so a
 * later price change touches no line. `total_minor` is `quantity` times `unit_price_minor`, rounded half up, minus
 * `discount_minor` (a check), and the discount stays zero until feature 8. `service_id` is the Inventory module's
 * table, a plain uuid here with its key in the migration; `product_id`, `lot_id`, `dispense_event_id`,
 * `administration_id` (slice 2) and `lab_order_id` (slice 9) arrive as nullable forward columns.
 */
export const invoiceLine = pgTable(
  'invoice_line',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoice.id),
    kind: text('kind', { enum: INVOICE_LINE_KINDS }).notNull(),
    serviceId: uuid('service_id'),
    descriptionAz: text('description_az'),
    descriptionRu: text('description_ru'),
    descriptionEn: text('description_en'),
    quantity: numeric('quantity', { mode: 'number' }).notNull(),
    /** The price list's price per unit when the line was added. */
    unitPriceMinor: minorUnits('unit_price_minor').notNull(),
    discountMinor: minorUnits('discount_minor').notNull().default(sql`0`),
    discountReason: text('discount_reason'),
    totalMinor: minorUnits('total_minor').notNull(),
    /** Null until OPEN-7 and VAT are answered. */
    taxRate: numeric('tax_rate', { mode: 'number' }),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    sort: integer('sort').notNull(),
    ...standardColumns(),
  },
  (table) => [
    check('invoice_line_kind_check', sql`${table.kind} in (${sqlList(INVOICE_LINE_KINDS)})`),
    check('invoice_line_service_check', sql`${table.kind} <> 'service' or ${table.serviceId} is not null`),
    check(
      'invoice_line_description_check',
      sql`coalesce(${table.descriptionAz}, ${table.descriptionRu}, ${table.descriptionEn}) is not null`,
    ),
    check('invoice_line_quantity_check', sql`${table.quantity} > 0`),
    check('invoice_line_unit_price_check', sql`${table.unitPriceMinor} >= 0`),
    check(
      'invoice_line_discount_check',
      sql`${table.discountMinor} >= 0 and ${table.discountMinor} <= ${table.quantity} * ${table.unitPriceMinor}`,
    ),
    check(
      'invoice_line_discount_reason_check',
      sql`${table.discountMinor} = 0 or coalesce(${table.discountReason}, '') ~ '\\S'`,
    ),
    /** Rounded half up to a minor unit (spec 0002, "Value sourcing": Issue an invoice); round() on numeric rounds half away from zero, which is half up for a positive amount. */
    check(
      'invoice_line_total_check',
      sql`${table.totalMinor} = round(${table.quantity} * ${table.unitPriceMinor}) - ${table.discountMinor}`,
    ),
    index('invoice_line_invoice_idx').on(table.invoiceId),
    index('invoice_line_service_idx').on(table.serviceId),
  ],
)

/** What moves a client's balance (spec 0002's sketch); feature 5 writes charges here and payments with #26. */
export const LEDGER_ENTRY_KINDS = [
  'charge',
  'charge_reversal',
  'payment',
  'refund',
  'adjustment',
  'opening_balance',
  'write_off',
] as const

/**
 * The client ledger (docs/domain.md §7.3: LedgerEntry; BL-6), append only: a debt is the sum of these rows
 * (`client_balance`), never a stored balance, and a correction is a new row. Signed: a charge is positive, a payment
 * negative. A charge, its reversal and a write off name their invoice (a check); a payment and a refund name theirs
 * once `payment_id` arrives with #26, and `import_batch_id` with slice 7. `client_id` is the Client module's table, a
 * plain uuid here with its key in the migration; an entry without a client (a counter sale) is in no balance.
 */
export const ledgerEntry = pgTable(
  'ledger_entry',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    clientId: uuid('client_id'),
    kind: text('kind', { enum: LEDGER_ENTRY_KINDS }).notNull(),
    amountMinor: minorUnits('amount_minor').notNull(),
    currency: currencyCode('currency').notNull().default(sql`'AZN'`),
    invoiceId: uuid('invoice_id').references(() => invoice.id),
    note: text('note'),
    /**
     * When the debt moved: the database clock for a charge at issue. Never in the future (the CHECK); no back dating
     * window (assert_backdate_limit()), which is for events a staff member enters, and an imported opening balance
     * (slice 7) will be older than any window.
     */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    ...standardColumns(),
  },
  (table) => [
    check('ledger_entry_kind_check', sql`${table.kind} in (${sqlList(LEDGER_ENTRY_KINDS)})`),
    check(
      'ledger_entry_invoice_check',
      sql`${table.kind} not in ('charge', 'charge_reversal', 'write_off') or ${table.invoiceId} is not null`,
    ),
    check('ledger_entry_occurred_at_check', sql`${table.occurredAt} <= now()`),
    index('ledger_entry_client_idx').on(table.clientId),
    index('ledger_entry_invoice_idx').on(table.invoiceId),
  ],
)
