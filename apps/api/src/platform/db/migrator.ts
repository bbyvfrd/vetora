import { fileURLToPath } from 'node:url'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate as applyMigrations } from 'drizzle-orm/pg-core'
import pg from 'pg'
import type { Logger } from 'pino'
import { log as baseLog, rootCause, scrubError } from '../log.js'
import { applyGrants, type Granted } from './grants.js'
import { MIGRATIONS_TABLE } from './table-classes.js'

/**
 * The migrate command's engine (spec 0001 "Migrations", spec 0002 "Interface surface"): one direct connection as
 * vetora_migrator (never the pooler), one advisory lock, the control set first, then the practice set applied to
 * every registered practice schema in registry order, the grants pass inside each schema's transaction. Drizzle's
 * migration table inside the schema it migrates is the truth (<schema>.__drizzle_migrations), and a schema's pending
 * migrations and its grants pass run in one transaction, so a failure in either leaves that schema as it was: the run
 * stops there, earlier schemas migrated, later ones untouched.
 */

/** The control set, in the checkout and in the image: apps/api/drizzle/control, beside dist/. */
export const CONTROL_MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../drizzle/control', import.meta.url))

/** The practice set, applied to every practice schema: apps/api/drizzle/practice, beside dist/. */
export const PRACTICE_MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../drizzle/practice', import.meta.url))

/** The one key every migrate (and later provision) run takes with pg_try_advisory_lock, so runs never overlap (AC-10). */
export const MIGRATE_LOCK_KEY = 20261022

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
   * A schema's run failed and the loop stopped there: its batch (`migrations`) or the grants pass after it (`grants`)
   * refused, and the schema's one transaction rolled back, so nothing of `pending` landed. Earlier schemas are
   * migrated, later ones untouched.
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
  // Rows a migration writes are attributed to the set (IN-1): audit_row() reads app.migration on a migrator session; a
  // data migration that writes rows names its own folder at its top: select set_config('app.migration', '<folder>', true).
  await setMigrationSource(client, 'control')
  const controlPending = await pendingMigrations(client, 'control', controlFolder)

  if (dryRun) {
    log.info({ schema: 'control', pending: controlPending }, dryRunMessage(controlPending))
  } else if (controlPending.length === 0) {
    log.info({ schema: 'control' }, 'nothing to do')
  } else {
    try {
      await applySet(drizzle({ client }), controlFolder, 'control')
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
  await setMigrationSource(client, 'practice')
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

/**
 * Drizzle's migrate() over one set: the folder's migrations, <schema>.__drizzle_migrations as the truth, every pending
 * one in a transaction; handed a transaction as `db`, it nests that batch as a savepoint.
 */
function applySet(db: Parameters<typeof applyMigrations>[1], folder: string, schema: string) {
  return applyMigrations(readMigrationFiles({ migrationsFolder: folder }), db, {
    migrationsFolder: folder,
    migrationsSchema: schema,
    migrationsTable: MIGRATIONS_TABLE,
  })
}

/** The name audit_event.source carries for rows this connection writes from here on: migration:<name>. */
async function setMigrationSource(client: pg.Client, name: string): Promise<void> {
  await client.query("select set_config('app.migration', $1, false)", [name])
}

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
  /** The batch (`migrations`) or the grants pass (`grants`) refused; the schema's transaction rolled back and nothing of `pending` landed. */
  | { status: 'failed'; schema: string; step: 'migrations' | 'grants'; pending: string[]; error: unknown }

type PracticeRunOptions = { practiceFolder: string; log: Logger }

/**
 * Bring one practice schema up to the practice set and run the grants pass, in one transaction (spec 0002, "Interface
 * surface"; "Security model": Grants pass): search_path is set to the schema (and ext) for the transaction, so every
 * unqualified name in the set lands there and the migrations table inside the schema is the truth, and the pass sees
 * the batch's tables before anything is committed, so a table without a class or a trigger rolls its migration back
 * with it. Drizzle's migrate() nests its own transaction as a savepoint when handed one. Shared by migrate's practice
 * loop and by provision-practice.
 */
export async function migratePractice(
  client: pg.Client,
  { slug, schema, role }: PracticeTarget,
  { practiceFolder, log }: PracticeRunOptions,
): Promise<PracticeRun> {
  const pending = await pendingMigrations(client, schema, practiceFolder)
  // Which step the transaction is in when it fails; a property, since the step advances inside the callback.
  const progress: { step: 'migrations' | 'grants' } = { step: 'migrations' }
  let granted: Granted
  try {
    granted = await drizzle({ client }).transaction(async (tx) => {
      await client.query(`set local search_path to ${pg.escapeIdentifier(schema)}, ext`)
      if (pending.length > 0) {
        await applySet(tx, practiceFolder, schema)
      }
      progress.step = 'grants'
      return applyGrants(client, { schema, role })
    })
  } catch (error) {
    scrubError(error)
    const message =
      progress.step === 'migrations'
        ? 'migration failed, batch rolled back'
        : 'grants pass refused the schema, batch rolled back'
    log.error({ schema, slug, role, pending, err: rootCause(error) }, message)
    return { status: 'failed', schema, step: progress.step, pending, error }
  }
  if (pending.length === 0) log.info({ schema, slug }, 'nothing to do')
  for (const migration of pending) log.info({ schema, slug, migration }, 'applied')
  log.info({ schema, slug, role, ...granted }, 'grants applied')
  return { status: 'applied', applied: pending }
}
