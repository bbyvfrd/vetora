import { fileURLToPath } from 'node:url'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate as applyMigrations } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import type { Logger } from 'pino'
import { log as baseLog, rootCause, scrubError } from '../log.js'
import { applyGrants } from './grants.js'

/**
 * The migrate command's engine (spec 0001 "Migrations", spec 0002 "Interface surface"): one direct connection as
 * vetora_migrator (never the pooler), one advisory lock, the control set first, then the practice set applied to
 * every registered practice schema in registry order with the grants step after each. Drizzle's migration table
 * inside the schema it migrates is the truth (<schema>.__drizzle_migrations), and Drizzle applies every pending
 * migration of a schema in one transaction, so a failure leaves that schema as it was: the run stops there, earlier
 * schemas migrated, later ones untouched.
 */

/** The control set, in the checkout and in the image: apps/api/drizzle/control, beside dist/. */
export const CONTROL_MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../drizzle/control', import.meta.url))

/** The practice set, applied to every practice schema: apps/api/drizzle/practice, beside dist/. */
export const PRACTICE_MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../drizzle/practice', import.meta.url))

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
  /** Limit the practice loop to the practice with this slug; the control set is applied first either way. */
  practice?: string
  /** The two sets' folders; tests pass temporary ones. */
  controlFolder?: string
  practiceFolder?: string
  log?: Logger
}

/** One practice schema's share of a run, in registry order. */
export type PracticeApplied = { slug: string; schema: string; applied: string[] }
export type PracticePending = { slug: string; schema: string; pending: string[] }

export type MigrateOutcome =
  /** Every schema is current: `applied` names what this run applied to control, `practices` to each practice schema. */
  | { status: 'applied'; applied: string[]; practices: PracticeApplied[] }
  | { status: 'dry-run'; pending: string[]; practices: PracticePending[] }
  | { status: 'lock-held' }
  /**
   * A schema's run failed and the loop stopped there: its batch was rolled back (`migrations`, nothing of `pending`
   * landed), or its grants step failed after the batch committed (`grants`). Earlier schemas are migrated, later ones untouched.
   */
  | { status: 'failed'; schema: string; step: 'migrations' | 'grants'; pending: string[]; error: unknown }
  /** `--practice <slug>` named a slug the registry does not hold. */
  | { status: 'not-registered'; slug: string }

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
    return await run(client, {
      controlFolder,
      practiceFolder: options.practiceFolder ?? PRACTICE_MIGRATIONS_FOLDER,
      dryRun: options.dryRun ?? false,
      practice: options.practice,
      log,
    })
  } finally {
    await client.end()
  }
}

/** The options with every default filled in. */
type ResolvedOptions = {
  controlFolder: string
  practiceFolder: string
  dryRun: boolean
  practice?: string
  log: Logger
}

async function run(
  client: pg.Client,
  { controlFolder, practiceFolder, dryRun, practice, log }: ResolvedOptions,
): Promise<MigrateOutcome> {
  const started = performance.now()
  const controlPending = await pendingMigrations(client, 'control', controlFolder)

  if (dryRun) {
    log.info({ schema: 'control', pending: controlPending }, dryRunMessage(controlPending))
  } else if (controlPending.length === 0) {
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
      log.error(
        { schema: 'control', pending: controlPending, err: rootCause(error) },
        'migration failed, batch rolled back',
      )
      return { status: 'failed', schema: 'control', step: 'migrations', pending: controlPending, error }
    }
    for (const migration of controlPending) log.info({ schema: 'control', migration }, 'applied')
  }

  // The registry is read after the control set, which may have just created it.
  const registered = await registeredPractices(client)
  const targets = practice === undefined ? registered : registered.filter((row) => row.slug === practice)
  if (practice !== undefined && targets.length === 0) {
    log.error({ slug: practice }, 'practice not registered')
    return { status: 'not-registered', slug: practice }
  }

  if (dryRun) {
    const practices: PracticePending[] = []
    for (const { slug, schema } of targets) {
      const pending = await pendingMigrations(client, schema, practiceFolder)
      log.info({ schema, slug, pending }, dryRunMessage(pending))
      practices.push({ slug, schema, pending })
    }
    return { status: 'dry-run', pending: controlPending, practices }
  }

  const practices: PracticeApplied[] = []
  for (const target of targets) {
    const result = await migratePractice(client, target, { practiceFolder, log })
    if (result.status === 'failed') return result
    practices.push({ slug: target.slug, schema: target.schema, applied: result.applied })
  }
  const durationMs = Math.round(performance.now() - started)
  log.info({ applied: controlPending.length, practices: practices.length, durationMs }, 'migrate done')
  return { status: 'applied', applied: controlPending, practices }
}

const dryRunMessage = (pending: string[]) => (pending.length ? 'dry run: would apply' : 'dry run: nothing to do')

/** The set's migrations not yet recorded in <schema>.__drizzle_migrations, in apply order. */
async function pendingMigrations(client: pg.Client, schema: string, folder: string): Promise<string[]> {
  const local = readMigrationFiles({ migrationsFolder: folder }).map((migration) => migration.name)
  const applied = await appliedMigrations(client, schema)
  return local.filter((name) => !applied.has(name))
}

/** The names recorded in <schema>.__drizzle_migrations; none when the table is not there yet (a dry run never creates it). */
async function appliedMigrations(client: pg.Client, schema: string): Promise<Set<string>> {
  const table = `${pg.escapeIdentifier(schema)}.${MIGRATIONS_TABLE}`
  if (!(await exists(client, table))) return new Set()
  const rows = await client.query<{ name: string | null }>(`select name from ${table}`)
  return new Set(rows.rows.flatMap((row) => (row.name ? [row.name] : [])))
}

/**
 * The registry in apply order, registry order (spec 0002, "Interface surface": `created_at`, then `id`); empty when
 * the registry is not there yet (a dry run against an empty database).
 */
async function registeredPractices(client: pg.Client): Promise<PracticeTarget[]> {
  if (!(await exists(client, 'control.practice'))) return []
  const rows = await client.query<{ slug: string; schema_name: string; role_name: string }>(
    'select slug, schema_name, role_name from control.practice order by created_at, id',
  )
  return rows.rows.map((row) => ({ slug: row.slug, schema: row.schema_name, role: row.role_name }))
}

async function exists(client: pg.Client, qualifiedTable: string): Promise<boolean> {
  const result = await client.query<{ found: string | null }>('select to_regclass($1) as found', [qualifiedTable])
  return result.rows[0]?.found != null
}

/** A registered practice as the practice loop addresses it: its schema and the role that holds the schema's grants. */
export type PracticeTarget = { slug: string; schema: string; role: string }

export type PracticeRun =
  /** The schema is current and its grants are set: `applied` names what this run applied. */
  | { status: 'applied'; applied: string[] }
  /** The batch was rolled back (`migrations`), or the grants step failed after the batch committed (`grants`). */
  | { status: 'failed'; schema: string; step: 'migrations' | 'grants'; pending: string[]; error: unknown }

type PracticeRunOptions = { practiceFolder: string; log: Logger }

/**
 * Bring one practice schema up to the practice set, then run the grants step (spec 0002, "Interface surface"):
 * search_path is set to the schema (and ext), so every unqualified name in the set lands there, and the migrations
 * table inside the schema is the truth. Shared by migrate's practice loop and by provision-practice.
 */
export async function migratePractice(
  client: pg.Client,
  { slug, schema, role }: PracticeTarget,
  { practiceFolder, log }: PracticeRunOptions,
): Promise<PracticeRun> {
  const pending = await pendingMigrations(client, schema, practiceFolder)
  await client.query(`set search_path to ${pg.escapeIdentifier(schema)}, ext`)
  try {
    if (pending.length === 0) {
      log.info({ schema, slug }, 'nothing to do')
    } else {
      try {
        await applyMigrations(drizzle({ client }), {
          migrationsFolder: practiceFolder,
          migrationsSchema: schema,
          migrationsTable: MIGRATIONS_TABLE,
        })
      } catch (error) {
        scrubError(error)
        log.error({ schema, slug, pending, err: rootCause(error) }, 'migration failed, batch rolled back')
        return { status: 'failed', schema, step: 'migrations', pending, error }
      }
      for (const migration of pending) log.info({ schema, slug, migration }, 'applied')
    }
    try {
      await applyGrants(client, { schema, role }, log)
    } catch (error) {
      scrubError(error)
      log.error({ schema, slug, role, err: rootCause(error) }, 'grants step failed')
      return { status: 'failed', schema, step: 'grants', pending: [], error }
    }
  } finally {
    await client.query('reset search_path')
  }
  return { status: 'applied', applied: pending }
}
