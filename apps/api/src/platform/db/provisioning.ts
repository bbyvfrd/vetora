import pg from 'pg'
import type { Logger } from 'pino'
import { z } from 'zod'
import { auth } from '../auth/auth.js'
import { ensureLogin } from '../auth/logins.js'
import { HANDLE, PRACTICE_CODE } from '../auth/names.js'
import { uuidv7 } from '../ids.js'
import { log as baseLog } from '../log.js'
import { LANG_CODES } from './domains.js'
import { MIGRATE_LOCK_KEY, migratePractice, PRACTICE_MIGRATIONS_FOLDER } from './migrator.js'

/**
 * The provision-practice command's engine (spec 0001 "Provisioning", spec 0002 "Interface surface", spec #18
 * "Commands"): one direct connection as vetora_migrator under the migrate lock, and the steps in order, each
 * idempotent, so a rerun completes whatever an earlier run left undone and changes nothing that is already there: the
 * registry row (status provisioning) → the practice role and vetora_app's membership → the schema → the practice set
 * and the grants pass → the manager's login (Better Auth's createUser) and the practice's organization (its
 * createOrganization as a system action for that login, the hook giving it the registry's id, Better Auth writing the
 * manager's membership) → the manager's staff_member row, the settings row, and the default location, written as the
 * manager → status active. The registry row is written first and the status last, so a crash midway leaves a
 * provisioning row the rerun completes. Every row the run writes is attributed (IN-1): app.migration marks the source
 * and the manager is the actor.
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

/**
 * The command's arguments, validated: the slug is the practice code staff sign in with and the command's name for the
 * practice, the manager's handle and name make the first login, the rest seeds practice_settings and location.
 */
export const provisionInput = z.object({
  slug: z.string().regex(PRACTICE_CODE, 'lower case letters, digits, and hyphens between them'),
  /** Both legal_name and display_name until the clinic edits them, and the organization's name. */
  name: z.string().trim().min(1),
  /** The first manager's handle: they sign in as `<handle>@<slug>`. */
  managerHandle: z
    .string()
    .regex(HANDLE, 'lower case letters, digits, dots and underscores, starting with a letter or digit'),
  managerName: z.string().trim().min(1),
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
  /** The manager's password, asked for only when their login is created (a hidden prompt, or standard input). */
  managerPassword: () => Promise<string>
  /** The practice set's folder; tests pass a temporary one. */
  practiceFolder?: string
  log?: Logger
}

export type ProvisionOutcome =
  /** Every step is in place and the practice is active: the id to print, the schema and role that hold it, its manager. */
  | { status: 'provisioned'; practiceId: string; schema: string; role: string; managerId: string }
  | { status: 'lock-held' }
  /** The slug belongs to a practice with another name: nothing was changed. */
  | { status: 'slug-taken'; slug: string }
  /** The practice set or the grants pass failed and the schema's transaction rolled back; the registry row stays in provisioning for a rerun. */
  | { status: 'failed'; schema: string; step: 'migrations' | 'grants'; pending: string[]; error: unknown }
  /** The manager's login needed a password and the one given is too short or too long; the rerun asks again. */
  | { status: 'password-rejected'; problem: 'too-short' | 'too-long' }

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
    // audit_row() records what this run writes as migration:provision-practice (spec 0002, "Conventions": Actor).
    await client.query("select set_config('app.migration', 'provision-practice', false)")

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

    const manager = await ensureOrganization(client, { practiceId, schema, input, password: options.managerPassword })
    if (manager.status === 'password-rejected') return manager
    const { managerId } = manager
    log.info(
      { slug: input.slug, practiceId, managerId, written: manager.written },
      'manager login and organization in place',
    )

    const { actor, ...inserted } = await seedPractice(client, schema, input, managerId)
    log.info(
      { slug: input.slug, practiceId, actorId: actor, inserted },
      'manager, settings and default location in place',
    )

    const activated = await client.query(
      "update control.practice set status = 'active', updated_at = now() where id = $1 and status = 'provisioning'",
      [practiceId],
    )
    const durationMs = Math.round(performance.now() - started)
    log.info({ slug: input.slug, practiceId, activated: activated.rowCount === 1, durationMs }, 'practice provisioned')
    return { status: 'provisioned', practiceId, schema, role, managerId }
  } finally {
    await client.end()
  }
}

type Registered = { id: string; schema: string; role: string; status: string; created: boolean }

/**
 * The registry row for the slug: the existing one when its name matches, a new one in status provisioning otherwise;
 * undefined when the slug is held under another name. The id is a UUID v7 issued by Postgres, which the organization
 * then takes (spec 0002, "Value sourcing": Provision a practice; spec #18): schema p_<id>, role p_<id>_role.
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

/** The practice's first staff member, the one every seed row names as its actor, or undefined while it has none. */
async function firstStaffMember(client: pg.Client, schema: string): Promise<string | undefined> {
  const first = await client.query<{ id: string }>(
    `select id from ${pg.escapeIdentifier(schema)}.staff_member order by created_at, id limit 1`,
  )
  return first.rows[0]?.id
}

/** What ensureOrganization() leaves: the manager the organization names, and which of the three this run wrote. */
type ManagerOutcome =
  | { status: 'in-place'; managerId: string; written: { login: boolean; organization: boolean; membership: boolean } }
  | { status: 'password-rejected'; problem: 'too-short' | 'too-long' }

/**
 * The practice's organization and its first manager's login and membership. While the organization is missing, the
 * manager's login is found or created (with the id of the practice's first staff member when one exists, so a practice
 * provisioned before sign in gains the login its staff_member row already names), and the organization is created for
 * it; Better Auth writes the membership as manager. Once the organization exists, the manager is the member who holds
 * the manager role longest and a rerun's arguments change nothing, whichever handle they name; a membership
 * an interrupted run left out is written here for the given handle's login.
 */
async function ensureOrganization(
  client: pg.Client,
  context: { practiceId: string; schema: string; input: ProvisionInput; password: () => Promise<string> },
): Promise<ManagerOutcome> {
  const { practiceId, schema, input } = context
  const written = { login: false, organization: false, membership: false }
  const login = async () =>
    ensureLogin({
      handle: input.managerHandle,
      practiceCode: input.slug,
      name: input.managerName,
      // The practice's default language; provisionInput keeps at least one.
      language: input.languages[0] ?? 'az',
      password: context.password,
      id: await firstStaffMember(client, schema),
    })
  const organization = await client.query('select 1 from control.organization where id = $1', [practiceId])
  if (organization.rowCount === 0) {
    const ensured = await login()
    if (ensured.status === 'password-rejected') return ensured
    written.login = ensured.status === 'created'
    // A system action (no session, a userId): it bypasses allowUserToCreateOrganization: false, and the hook gives the
    // organization the registry's id (src/platform/auth/auth.ts).
    await auth().api.createOrganization({ body: { name: input.name, slug: input.slug, userId: ensured.userId } })
    written.organization = true
  }
  const managerOf = async () =>
    (
      await client.query<{ user_id: string }>(
        `select user_id from control.member
         where organization_id = $1 and 'manager' = any (string_to_array(role, ','))
         order by created_at, id limit 1`,
        [practiceId],
      )
    ).rows[0]?.user_id
  const found = await managerOf()
  if (found) return { status: 'in-place', managerId: found, written }
  const ensured = await login()
  if (ensured.status === 'password-rejected') return ensured
  written.login ||= ensured.status === 'created'
  await client.query(
    `insert into control.member (id, organization_id, user_id, role, created_at) values ($1, $2, $3, 'manager', now())
     on conflict (organization_id, user_id) do nothing`,
    [uuidv7(), practiceId, ensured.userId],
  )
  written.membership = true
  const managerId = await managerOf()
  if (!managerId) throw new Error('the manager membership is missing after its insert')
  return { status: 'in-place', managerId, written }
}

/**
 * The seed rows, each inserted only when missing, so a rerun never overwrites what the clinic has edited since: the
 * first manager's staff_member row (roles {manager}, only while the practice has no staff), the settings row from the
 * arguments, and the default location (IN-5: a location from day one). Every row is written as the practice's first
 * manager (IN-1), the one the organization names on the first run and the one already there on a rerun, so a rerun
 * changes nothing and one that completes a missing row still names a staff member (AC-10). The practice set ran
 * before the actor was set, so a data migration's rows carry none, as under migrate.
 */
async function seedPractice(
  client: pg.Client,
  schema: string,
  input: ProvisionInput,
  managerId: string,
): Promise<{ actor: string; manager: boolean; settings: boolean; location: boolean }> {
  const schemaId = pg.escapeIdentifier(schema)
  const actor = (await firstStaffMember(client, schema)) ?? managerId
  await client.query("select set_config('app.actor_id', $1, false)", [actor])
  const manager = await client.query(
    `insert into ${schemaId}.staff_member (id, display_name, roles, active, synced_at)
     select $1, $2, '{manager}', true, now()
     where not exists (select 1 from ${schemaId}.staff_member)`,
    [managerId, input.managerName],
  )
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
  return {
    actor,
    manager: manager.rowCount === 1,
    settings: settings.rowCount === 1,
    location: location.rowCount === 1,
  }
}
