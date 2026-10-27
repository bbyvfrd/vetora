import { readdirSync } from 'node:fs'
import { eq, sql } from 'drizzle-orm'
import { practice } from './db/control-schema.js'
import { db } from './db/index.js'
import { PRACTICE_MIGRATIONS_FOLDER } from './db/migrator.js'

/**
 * The practice registry as the request context reads it (spec 0001, "Tenancy and data topology": the registry cache
 * lives at most 30 seconds and is cleared on change; spec 0002, "Value sourcing": Resolve the tenant): a practice's
 * schema and role, its status, and how far its schema has migrated, by id, cached per process. Nothing in the API
 * changes the registry yet; the commands that do run in their own process, so the 30 seconds bound how long a change
 * takes to reach a running API, and forgetPractice() is what a change made in this process (and a test) calls.
 */

export type RegisteredPractice = {
  id: string
  slug: string
  status: (typeof practice.$inferSelect)['status']
  schemaName: string
  roleName: string
  /** The newest practice migration recorded in the schema, or null when it has none (control.practice_schema_migration). */
  schemaMigration: string | null
}

const TTL_MS = 30_000

const cache = new Map<string, { practice: RegisteredPractice; until: number }>()

/** The registry row of a practice, with its schema's migration, from the cache when read in the last 30 seconds. */
export async function registeredPractice(id: string): Promise<RegisteredPractice | undefined> {
  const cached = cache.get(id)
  if (cached && cached.until > Date.now()) return cached.practice
  const [row] = await db()
    .select({
      id: practice.id,
      slug: practice.slug,
      status: practice.status,
      schemaName: practice.schemaName,
      roleName: practice.roleName,
      schemaMigration: sql<string | null>`control.practice_schema_migration(${practice.id})`,
    })
    .from(practice)
    .where(eq(practice.id, id))
  // A miss is not kept: a practice being provisioned is served as soon as its row is there.
  if (row) cache.set(id, { practice: row, until: Date.now() + TTL_MS })
  return row
}

/** Clear a practice's cached row, or every row: the next request reads the registry again. */
export function forgetPractice(id?: string): void {
  if (id === undefined) cache.clear()
  else cache.delete(id)
}

let codeMigration: string | undefined

/** The newest migration of the practice set this code carries (the image ships the folder beside dist/). */
function newestPracticeMigration(): string {
  codeMigration ??= readdirSync(PRACTICE_MIGRATIONS_FOLDER, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .at(-1)
  if (!codeMigration) throw new Error(`no practice migrations in ${PRACTICE_MIGRATIONS_FOLDER}`)
  return codeMigration
}

/**
 * Whether the practice's schema is behind this code, so the API must not serve it until migrate has run. A schema
 * ahead of the code is served: migrate runs before traffic switches (spec 0001), so the outgoing image meets newer
 * schemas during every deploy, and the two step rule keeps them compatible.
 */
export function isBehind(registered: RegisteredPractice): boolean {
  return registered.schemaMigration === null || registered.schemaMigration < newestPracticeMigration()
}
