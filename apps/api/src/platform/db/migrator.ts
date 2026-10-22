import { fileURLToPath } from 'node:url'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate as applyMigrations } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import type { Logger } from 'pino'
import { log as baseLog, rootCause, scrubError } from '../log.js'

/**
 * The migrate command's engine (spec 0001 "Migrations", spec 0002 "Interface surface"): one direct connection as
 * vetora_migrator (never the pooler), one advisory lock, the control set first. Drizzle's migration table inside the
 * schema it migrates is the truth (control.__drizzle_migrations), and Drizzle applies every pending migration in one
 * transaction, so a failure leaves the schema as it was. The practice set, the grants pass, and provisioning arrive
 * with the next data model tickets; this run already reads the registry in the order they will use.
 */

/** The control set, in the checkout and in the image: apps/api/drizzle/control, beside dist/. */
export const CONTROL_MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../drizzle/control', import.meta.url))

/** The one key every migrate (and later provision) run takes with pg_try_advisory_lock, so runs never overlap (AC-10). */
export const MIGRATE_LOCK_KEY = 20261022

export const MIGRATIONS_TABLE = '__drizzle_migrations'

/** The command's logger: every line of a run carries `command: 'migrate'`. */
export const migrateLog = baseLog.child({ command: 'migrate' })

export type MigrateOptions = {
  /** DATABASE_URL_MIGRATOR: vetora_migrator on a direct connection. */
  url: string
  /** List what would be applied and change nothing. */
  dryRun?: boolean
  /** The control set's folder; tests pass a temporary one. */
  controlFolder?: string
  log?: Logger
}

export type MigrateOutcome =
  /** The control set is current: `applied` names what this run applied, empty when there was nothing to do. */
  | { status: 'applied'; applied: string[] }
  | { status: 'dry-run'; pending: string[] }
  | { status: 'lock-held' }
  /** A migration failed and Drizzle rolled the batch back: nothing of `pending` landed. */
  | { status: 'failed'; pending: string[]; error: unknown }

export async function migrate(options: MigrateOptions): Promise<MigrateOutcome> {
  const log = options.log ?? migrateLog
  const controlFolder = options.controlFolder ?? CONTROL_MIGRATIONS_FOLDER
  const client = new pg.Client({ connectionString: options.url, application_name: 'vetora-migrate' })
  await client.connect()
  try {
    // A session lock: released with the connection, so a crash never leaves it behind.
    const lock = await client.query<{ locked: boolean }>('select pg_try_advisory_lock($1) as locked', [
      MIGRATE_LOCK_KEY,
    ])
    if (!lock.rows[0]?.locked) {
      log.warn('another migrate holds the lock')
      return { status: 'lock-held' }
    }
    return await run(client, { controlFolder, dryRun: options.dryRun ?? false, log })
  } finally {
    await client.end()
  }
}

/** The options with every default filled in. */
type ResolvedOptions = { controlFolder: string; dryRun: boolean; log: Logger }

async function run(client: pg.Client, { controlFolder, dryRun, log }: ResolvedOptions): Promise<MigrateOutcome> {
  const started = performance.now()
  const local = readMigrationFiles({ migrationsFolder: controlFolder }).map((migration) => migration.name)
  const applied = await appliedMigrations(client, 'control')
  const pending = local.filter((name) => !applied.has(name))

  if (dryRun) {
    log.info({ schema: 'control', pending }, pending.length ? 'dry run: would apply' : 'dry run: nothing to do')
  } else if (pending.length === 0) {
    log.info({ schema: 'control' }, 'nothing to do')
  } else {
    try {
      await applyMigrations(drizzle({ client }), {
        migrationsFolder: controlFolder,
        migrationsSchema: 'control',
        migrationsTable: MIGRATIONS_TABLE,
      })
    } catch (error) {
      scrubError(error)
      log.error({ schema: 'control', pending, err: rootCause(error) }, 'migration failed, batch rolled back')
      return { status: 'failed', pending, error }
    }
    for (const migration of pending) log.info({ schema: 'control', migration }, 'applied')
  }

  const practices = await registeredPractices(client)
  log.info({ practices }, 'practice set: nothing to apply')
  if (dryRun) return { status: 'dry-run', pending }
  const durationMs = Math.round(performance.now() - started)
  log.info({ schema: 'control', applied: pending.length, practices: practices.length, durationMs }, 'migrate done')
  return { status: 'applied', applied: pending }
}

/** The names recorded in <schema>.__drizzle_migrations; none when the table is not there yet (a dry run never creates it). */
async function appliedMigrations(client: pg.Client, schema: string): Promise<Set<string>> {
  const table = `${schema}.${MIGRATIONS_TABLE}`
  if (!(await exists(client, table))) return new Set()
  const rows = await client.query<{ name: string | null }>(
    `select name from ${pg.escapeIdentifier(schema)}.${pg.escapeIdentifier(MIGRATIONS_TABLE)}`,
  )
  return new Set(rows.rows.flatMap((row) => (row.name ? [row.name] : [])))
}

/**
 * The registry's slugs in the order the practice set is applied: registry order (spec 0002, "Interface surface"),
 * which the data model tickets spell as `created_at`, then `id`. Empty on a dry run against an empty database.
 */
async function registeredPractices(client: pg.Client): Promise<string[]> {
  if (!(await exists(client, 'control.practice'))) return []
  const rows = await client.query<{ slug: string }>('select slug from control.practice order by created_at, id')
  return rows.rows.map((row) => row.slug)
}

async function exists(client: pg.Client, qualifiedTable: string): Promise<boolean> {
  const result = await client.query<{ found: string | null }>('select to_regclass($1) as found', [qualifiedTable])
  return result.rows[0]?.found != null
}
