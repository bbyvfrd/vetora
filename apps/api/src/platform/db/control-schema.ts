import { sql } from 'drizzle-orm'
import { check, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * The control schema (spec 0002, "Data model sketch": Control schema): the practice registry, routing and status
 * only; the sign in tables join it in slice 1. drizzle-kit reads this file through drizzle.control.config.ts and writes the control
 * set to drizzle/control/. The ext schema with its extensions, the unaccent wrapper, and the grants are hand
 * written into the same migration, since drizzle-kit models tables, not functions or grants.
 */
export const control = pgSchema('control')

/** The registry's state machine: a text column with a check, as every fixed value set (spec 0002, "Value sets"). */
const practiceStatuses = ['provisioning', 'active', 'suspended', 'archived'] as const

export const practice = control.table(
  'practice',
  {
    /** Equals the sign in organisation id from slice 1; until then a UUID v7 issued by Postgres 18. */
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
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
  (table) => [
    check(
      'practice_status_check',
      sql`${table.status} in (${sql.raw(practiceStatuses.map((status) => `'${status}'`).join(', '))})`,
    ),
  ],
)
