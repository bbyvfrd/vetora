import { randomUUID } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import pg from 'pg'
import { type Logger, pino } from 'pino'
import { CONTROL_MIGRATIONS_FOLDER, PRACTICE_MIGRATIONS_FOLDER } from './migrator.js'
import { type ProvisionInput, provisionPractice } from './provisioning.js'
import { MIGRATIONS_TABLE } from './table-classes.js'
import { dropRole, type TestDatabaseUrls } from './test-database.js'

/**
 * The helpers the database tests share (spec 0002, "Critical test scenarios"): the migration sets as folders, a
 * throwaway practice, a request transaction as its role, a log capture, two catalog reads. The test database itself (its URLs, the reset, the Vitest globalSetup) is
 * test-database.ts, re-exported here so a test imports one module. Kept out of dist/ by tsconfig.build.json.
 */
export {
  databaseTestsEnabled,
  resetTestDatabase,
  TEST_DATABASE,
  type TestDatabaseUrls,
  testDatabaseUrls,
} from './test-database.js'

/** The two sets as drizzle-kit lays them out: one folder per migration, applied in name order (spec 0001, "Migrations"). */
export const controlSet = (): string[] => readdirSync(CONTROL_MIGRATIONS_FOLDER).sort()
export const practiceSet = (): string[] => readdirSync(PRACTICE_MIGRATIONS_FOLDER).sort()

/** A copy of a migration set in a temporary folder with one more migration at the end; the caller removes the folder. */
export function withExtraMigration(source: string, name: string, sql: string): string {
  const folder = mkdtempSync(join(tmpdir(), 'vetora-migrations-'))
  cpSync(source, folder, { recursive: true })
  mkdirSync(join(folder, name))
  writeFileSync(join(folder, name, 'migration.sql'), sql)
  return folder
}

/** The migration names recorded in <schema>.__drizzle_migrations, in apply order. */
export async function recordedMigrations(client: pg.Client, schema: string): Promise<string[]> {
  const rows = await client.query<{ name: string }>(
    `select name from ${pg.escapeIdentifier(schema)}.${MIGRATIONS_TABLE} order by id`,
  )
  return rows.rows.map((row) => row.name)
}

/** Whether <schema>.<table> exists. */
export async function tableExists(client: pg.Client, schema: string, table: string): Promise<boolean> {
  const found = await client.query<{ found: string | null }>('select to_regclass($1) as found', [
    `${pg.escapeIdentifier(schema)}.${pg.escapeIdentifier(table)}`,
  ])
  return found.rows[0]?.found != null
}

/** A throwaway practice for a test: provisioned as the command would, dropped by `drop()` as the migrator. */
export type TestPractice = {
  practiceId: string
  slug: string
  schema: string
  role: string
  /** The first manager's staff_member id: the actor a test's request transactions set (IN-1). */
  managerId: string
  drop: () => Promise<void>
}

type TestPracticeOptions = Partial<ProvisionInput> & { log?: Logger }

/**
 * Provision a practice with a unique slug (or the one given) through provisionPractice(), the same path the command
 * takes, and hand back what a test needs to address it; a test drops it afterwards with `drop()`.
 */
export async function provisionTestPractice(
  urls: TestDatabaseUrls,
  options: TestPracticeOptions = {},
): Promise<TestPractice> {
  const slug = options.slug ?? `t-${randomUUID().slice(0, 8)}`
  const input: ProvisionInput = {
    slug,
    name: options.name ?? `Practice ${slug}`,
    managerUserId: options.managerUserId ?? randomUUID(),
    managerName: options.managerName ?? 'Dr Test',
    locationName: options.locationName ?? 'Main',
    timeZone: options.timeZone ?? 'Asia/Baku',
    languages: options.languages ?? ['az', 'ru'],
  }
  const outcome = await provisionPractice({ url: urls.migrator, input, log: options.log })
  if (outcome.status !== 'provisioned') throw new Error(`test practice ${slug} was not provisioned: ${outcome.status}`)
  const practice = { practiceId: outcome.practiceId, slug, schema: outcome.schema, role: outcome.role }
  return { ...practice, managerId: input.managerUserId, drop: () => dropTestPractice(urls, practice) }
}

export type RequestOptions = {
  /** app.actor_id for the transaction: the practice's manager unless given; null leaves it unset and '' sets it empty, both refused by IN-1. */
  actor?: string | null
}

/**
 * One request transaction as the request context of slice 1 will run it (spec 0002, "Roles"): on a vetora_app
 * connection, SET LOCAL ROLE to the practice role and app.actor_id for the transaction, then `run`; committed when
 * `run` returns, rolled back when it throws, so a refused write leaves nothing and the connection is clean for the next case.
 */
export async function asPractice<T>(
  app: pg.Client,
  practice: Pick<TestPractice, 'role' | 'managerId'>,
  run: (client: pg.Client) => Promise<T>,
  { actor = practice.managerId }: RequestOptions = {},
): Promise<T> {
  await app.query('begin')
  try {
    await app.query(`set local role ${pg.escapeIdentifier(practice.role)}`)
    if (actor !== null) await app.query("select set_config('app.actor_id', $1, true)", [actor])
    const result = await run(app)
    await app.query('commit')
    return result
  } catch (error) {
    await app.query('rollback')
    throw error
  }
}

/** Remove a test practice as the migrator: its schema (cascade), what its role holds and the role, then its registry row. */
export async function dropTestPractice(
  urls: TestDatabaseUrls,
  { practiceId, schema, role }: Pick<TestPractice, 'practiceId' | 'schema' | 'role'>,
): Promise<void> {
  const client = new pg.Client({ connectionString: urls.migrator, application_name: 'vetora-test-practice' })
  await client.connect()
  try {
    await client.query(`drop schema if exists ${pg.escapeIdentifier(schema)} cascade`)
    await dropRole(client, role)
    await client.query('delete from control.practice where id = $1', [practiceId])
  } finally {
    await client.end()
  }
}

/** A pino logger whose JSON lines land in an array, so a test can read what a command logged. */
export function captureLog(): { log: Logger; lines: Array<Record<string, unknown>> } {
  const lines: Array<Record<string, unknown>> = []
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of String(chunk).split('\n')) {
        if (line.trim()) lines.push(JSON.parse(line))
      }
      callback()
    },
  })
  return { log: pino({ level: 'info' }, sink), lines }
}
