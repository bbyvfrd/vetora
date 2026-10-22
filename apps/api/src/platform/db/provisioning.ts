import pg from 'pg'
import type { Logger } from 'pino'
import { z } from 'zod'
import { log as baseLog } from '../log.js'
import { LANG_CODES } from './domains.js'
import { MIGRATE_LOCK_KEY, migratePractice, PRACTICE_MIGRATIONS_FOLDER } from './migrator.js'

/**
 * The provision-practice command's engine (spec 0001 "Provisioning", spec 0002 "Interface surface"): one direct
 * connection as vetora_migrator under the migrate lock, and the steps in order, each idempotent, so a rerun completes
 * whatever an earlier run left undone and changes nothing that is already there: the registry row (status
 * provisioning) → the practice role and vetora_app's membership → the schema → the practice set and the grants step
 * → the settings row and the default location → status active. The registry row is written first and the status
 * last, so a crash midway leaves a provisioning row the rerun completes. The manager's staff row arrives with the
 * audit ticket.
 */

/** The command's logger: every line of a run carries `command: 'provision-practice'`. */
export const provisionLog = baseLog.child({ command: 'provision-practice' })

/** An IANA zone name Node's ICU data knows; Postgres reads the same database (docs/domain.md §10). */
function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/** The command's arguments, validated: the slug is the practice's URL and command name, the rest seeds practice_settings and location. */
export const provisionInput = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/, 'lower case letters, digits, and hyphens between them'),
  /** Both legal_name and display_name until the clinic edits them. */
  name: z.string().trim().min(1),
  locationName: z.string().trim().min(1),
  timeZone: z.string().refine(isTimeZone, 'an IANA time zone name such as Asia/Baku').default('Asia/Baku'),
  /** The first one becomes default_language. */
  languages: z
    .array(z.enum(LANG_CODES))
    .min(1)
    .transform((codes) => [...new Set(codes)])
    .default(['az', 'ru']),
})

export type ProvisionInput = z.output<typeof provisionInput>

export type ProvisionOptions = {
  /** DATABASE_URL_MIGRATOR: vetora_migrator on a direct connection. */
  url: string
  input: ProvisionInput
  /** The practice set's folder; tests pass a temporary one. */
  practiceFolder?: string
  log?: Logger
}

export type ProvisionOutcome =
  /** Every step is in place and the practice is active: the id to print, and the schema and role that hold it. */
  | { status: 'provisioned'; practiceId: string; schema: string; role: string }
  | { status: 'lock-held' }
  /** The slug belongs to a practice with another name: nothing was changed. */
  | { status: 'slug-taken'; slug: string }
  /** The practice set or the grants step failed; the registry row stays in provisioning for a rerun. */
  | { status: 'failed'; schema: string; step: 'migrations' | 'grants'; pending: string[]; error: unknown }

export async function provisionPractice(options: ProvisionOptions): Promise<ProvisionOutcome> {
  const log = options.log ?? provisionLog
  const practiceFolder = options.practiceFolder ?? PRACTICE_MIGRATIONS_FOLDER
  const { input } = options
  const client = new pg.Client({ connectionString: options.url, application_name: 'vetora-provision-practice' })
  await client.connect()
  try {
    // The same session lock migrate takes: released with the connection, so a crash never leaves it behind.
    const lock = await client.query<{ locked: boolean }>('select pg_try_advisory_lock($1) as locked', [
      MIGRATE_LOCK_KEY,
    ])
    if (!lock.rows[0]?.locked) {
      log.warn({ slug: input.slug }, 'another migrate or provision-practice run holds the lock')
      return { status: 'lock-held' }
    }
    const started = performance.now()

    const registered = await registerPractice(client, input.slug, input.name)
    if (!registered) {
      log.error({ slug: input.slug }, 'the slug belongs to a practice with another name; nothing changed')
      return { status: 'slug-taken', slug: input.slug }
    }
    const { id: practiceId, schema, role } = registered
    log.info(
      { slug: input.slug, practiceId, status: registered.status },
      registered.created ? 'registered' : 'already registered',
    )

    await ensureRole(client, role)
    log.info({ slug: input.slug, practiceId, role }, 'role and membership in place')
    await client.query(`create schema if not exists ${pg.escapeIdentifier(schema)} authorization vetora_migrator`)
    log.info({ slug: input.slug, practiceId, schema }, 'schema in place')

    const run = await migratePractice(client, { slug: input.slug, schema, role }, { practiceFolder, log })
    if (run.status === 'failed') return run

    const seeded = await seedPractice(client, schema, input)
    log.info({ slug: input.slug, practiceId, inserted: seeded }, 'settings and default location in place')

    const activated = await client.query(
      "update control.practice set status = 'active', updated_at = now() where id = $1 and status = 'provisioning'",
      [practiceId],
    )
    const durationMs = Math.round(performance.now() - started)
    log.info({ slug: input.slug, practiceId, activated: activated.rowCount === 1, durationMs }, 'practice provisioned')
    return { status: 'provisioned', practiceId, schema, role }
  } finally {
    await client.end()
  }
}

type Registered = { id: string; schema: string; role: string; status: string; created: boolean }

/**
 * The registry row for the slug: the existing one when its name matches, a new one in status provisioning otherwise;
 * undefined when the slug is held under another name. The id is a UUID v7 issued by Postgres until the sign in
 * organisation exists (spec 0002, "Value sourcing": Provision a practice): schema p_<id>, role p_<id>_role.
 */
async function registerPractice(client: pg.Client, slug: string, name: string): Promise<Registered | undefined> {
  const registry = await client.query<{ found: string | null }>("select to_regclass('control.practice') as found")
  if (registry.rows[0]?.found == null) throw new Error('control.practice is missing: run migrate first')
  type Row = { id: string; name: string; schema_name: string; role_name: string; status: string }
  const existing = await client.query<Row>(
    'select id, name, schema_name, role_name, status from control.practice where slug = $1',
    [slug],
  )
  const found = existing.rows[0]
  if (found) {
    if (found.name !== name) return undefined
    return { id: found.id, schema: found.schema_name, role: found.role_name, status: found.status, created: false }
  }
  const inserted = await client.query<Row>(
    `with issued as (select uuidv7() as id)
     insert into control.practice (id, slug, name, schema_name, role_name)
     select id, $1, $2, 'p_' || id::text, 'p_' || id::text || '_role' from issued
     returning id, name, schema_name, role_name, status`,
    [slug, name],
  )
  const row = inserted.rows[0]
  if (!row) throw new Error('the registry insert returned no row')
  return { id: row.id, schema: row.schema_name, role: row.role_name, status: row.status, created: true }
}

/**
 * The practice role, NOLOGIN, with vetora_app a member that does not inherit it and may SET ROLE to it (spec 0002,
 * "Security model": Roles; Postgres 16 syntax). Creating needs CREATEROLE, which the infra script gave the migrator.
 */
async function ensureRole(client: pg.Client, role: string): Promise<void> {
  const roleId = pg.escapeIdentifier(role)
  const found = await client.query('select 1 from pg_roles where rolname = $1', [role])
  if (found.rowCount === 0) await client.query(`create role ${roleId} nologin`)
  await client.query(`grant ${roleId} to vetora_app with inherit false, set true`)
}

/**
 * The settings row from the arguments and the default location, each inserted only when missing, so a rerun never
 * overwrites what the clinic has edited since. IN-5: a location from day one.
 */
async function seedPractice(
  client: pg.Client,
  schema: string,
  input: ProvisionInput,
): Promise<{ settings: boolean; location: boolean }> {
  const schemaId = pg.escapeIdentifier(schema)
  const settings = await client.query(
    `insert into ${schemaId}.practice_settings (legal_name, display_name, time_zone, languages, default_language)
     values ($1, $1, $2, $3, $4)
     on conflict (id) do nothing`,
    [input.name, input.timeZone, input.languages, input.languages[0]],
  )
  const location = await client.query(
    `insert into ${schemaId}.location (name, is_default, active)
     select $1, true, true
     where not exists (select 1 from ${schemaId}.location where is_default)`,
    [input.locationName],
  )
  return { settings: settings.rowCount === 1, location: location.rowCount === 1 }
}
