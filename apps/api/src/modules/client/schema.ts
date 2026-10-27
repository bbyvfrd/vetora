import { sql } from 'drizzle-orm'
import { boolean, check, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { langCode, sqlList } from '../../platform/db/domains.js'
import { standardColumns } from '../../platform/db/platform-tables.js'

/**
 * The Client tables (spec 0002, "Data model sketch": Client): `client`, `client_contact` (slice 1, #21),
 * `consent_record` (slice 8). `ownership`, the shared kernel the two contexts co-own, is declared by the Patient
 * module. The `import_batch_id` forward column arrives with `import_batch` (slice 7). Every name and contact value is
 * personal data (spec 0002, "Security model"): it never reaches a URL, a log or Sentry.
 */

export const CLIENT_KINDS = ['person', 'organisation'] as const
export const CLIENT_STATUSES = ['active', 'archived'] as const

/** The person or organisation the clinic deals with and bills (docs/domain.md §7). No balance column (BL-6). */
export const client = pgTable(
  'client',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    /** Persons only on screen for now; the organisation kind stays in the table (spec #18). */
    kind: text('kind', { enum: CLIENT_KINDS }).notNull().default('person'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    patronymic: text('patronymic'),
    organisationName: text('organisation_name'),
    taxId: text('tax_id'),
    contactPerson: text('contact_person'),
    address: text('address'),
    /** The language of the documents and messages the clinic gives the client. */
    preferredLanguage: langCode('preferred_language').notNull(),
    notes: text('notes'),
    status: text('status', { enum: CLIENT_STATUSES }).notNull().default('active'),
    ...standardColumns(),
  },
  (table) => [
    check('client_kind_check', sql`${table.kind} in (${sqlList(CLIENT_KINDS)})`),
    check('client_status_check', sql`${table.status} in (${sqlList(CLIENT_STATUSES)})`),
    /** A person has a last name, an organisation its name (spec 0002; the interviews may relax the first). */
    check(
      'client_name_check',
      sql`(${table.kind} = 'person' and ${table.lastName} is not null) or (${table.kind} = 'organisation' and ${table.organisationName} is not null)`,
    ),
  ],
)

export const CONTACT_KINDS = ['phone', 'whatsapp', 'telegram', 'email'] as const

/** A way to reach a client: one phone is required at registration (spec #18); duplicates are warned about, never blocked. */
export const clientContact = pgTable(
  'client_contact',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    clientId: uuid('client_id')
      .notNull()
      .references(() => client.id),
    kind: text('kind', { enum: CONTACT_KINDS }).notNull(),
    /** As typed. */
    value: text('value').notNull(),
    /** E.164 for the phone kinds (the contracts' normalisePhone()), lower case for an email: what a lookup matches. */
    valueNormalised: text('value_normalised').notNull(),
    label: text('label'),
    isPrimary: boolean('is_primary').notNull().default(false),
    messagingAllowed: boolean('messaging_allowed').notNull().default(false),
    ...standardColumns(),
  },
  (table) => [
    check('client_contact_kind_check', sql`${table.kind} in (${sqlList(CONTACT_KINDS)})`),
    index('client_contact_client_idx').on(table.clientId),
    /** The phone lookup; not unique, since a family shares a number. */
    index('client_contact_value_normalised_idx').on(table.valueNormalised),
    /** One primary contact per client. */
    uniqueIndex('client_contact_primary_idx').on(table.clientId).where(sql`${table.isPrimary}`),
  ],
)
