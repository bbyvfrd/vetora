import { randomUUID } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import pg from 'pg'
import { type Logger, pino } from 'pino'
import { CONTROL_MIGRATIONS_FOLDER, PRACTICE_MIGRATIONS_FOLDER } from './migrator.js'
import { type ProvisionInput, provisionPractice } from './provisioning.js'

/**
 * The database tests run against `vetora_test`, never against `vetora` (spec 0002, "Critical test scenarios").
 * The URLs are derived from DATABASE_URL_MIGRATOR and DATABASE_URL_DIRECT by swapping the database name, so
 * the compose and CI values work unchanged; without them the database tests are skipped, except in CI, where
 * missing variables fail the run. This file is also the API project's Vitest globalSetup (`setup()` below) and
 * stays out of dist/ (tsconfig.build.json).
 */
export const TEST_DATABASE = 'vetora_test'

export type TestDatabaseUrls = {
  /** vetora_migrator on vetora_test: runs the migrations, owns everything, resets the database. */
  migrator: string
  /** vetora_app on vetora_test: what the API would see. */
  app: string
}

/** True when DATABASE_URL_MIGRATOR and DATABASE_URL_DIRECT are set: the database tests run, otherwise they are skipped. */
export function databaseTestsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.DATABASE_URL_MIGRATOR && env.DATABASE_URL_DIRECT)
}

/** The vetora_test URLs; throws when the variables are missing, so call it only once the tests are enabled. */
export function testDatabaseUrls(env: NodeJS.ProcessEnv = process.env): TestDatabaseUrls {
  const migrator = env.DATABASE_URL_MIGRATOR
  const app = env.DATABASE_URL_DIRECT
  if (!migrator || !app) {
    throw new Error('The database tests need DATABASE_URL_MIGRATOR and DATABASE_URL_DIRECT')
  }
  return { migrator: withDatabase(migrator, TEST_DATABASE), app: withDatabase(app, TEST_DATABASE) }
}

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url)
  parsed.pathname = `/${database}`
  return parsed.toString()
}

/**
 * Empty vetora_test as the migrator, which owns it all: drop `control`, `ext`, and every `p_*` schema, each
 * practice schema's `p_*_role` with it (DROP OWNED BY, then the role). Roles are cluster wide, so only the role of
 * a schema found here goes: a practice provisioned in `vetora` keeps its role.
 */
export async function resetTestDatabase(urls: TestDatabaseUrls = testDatabaseUrls()): Promise<void> {
  const client = new pg.Client({ connectionString: urls.migrator, application_name: 'vetora-test-reset' })
  await client.connect()
  try {
    const schemas = await client.query<{ nspname: string }>(
      "select nspname from pg_namespace where nspname in ('control', 'ext') or nspname like 'p\\_%' order by nspname",
    )
    for (const { nspname } of schemas.rows) {
      await client.query(`drop schema ${pg.escapeIdentifier(nspname)} cascade`)
      if (nspname.startsWith('p_')) await dropRole(client, `${nspname}_role`)
    }
  } finally {
    await client.end()
  }
}

async function dropRole(client: pg.Client, rolname: string): Promise<void> {
  const found = await client.query('select 1 from pg_roles where rolname = $1', [rolname])
  if (found.rowCount === 0) return
  const role = pg.escapeIdentifier(rolname)
  // DROP OWNED needs the role's privileges (Postgres 16+), which creating it did not give the migrator.
  await client.query(`grant ${role} to current_user`)
  await client.query(`drop owned by ${role}`)
  await client.query(`drop role ${role}`)
}

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

/** A throwaway practice for a test: provisioned as the command would, dropped by `drop()` as the migrator. */
export type TestPractice = {
  practiceId: string
  slug: string
  schema: string
  role: string
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
    locationName: options.locationName ?? 'Main',
    timeZone: options.timeZone ?? 'Asia/Baku',
    languages: options.languages ?? ['az', 'ru'],
  }
  const outcome = await provisionPractice({ url: urls.migrator, input, log: options.log })
  if (outcome.status !== 'provisioned') throw new Error(`test practice ${slug} was not provisioned: ${outcome.status}`)
  const practice = { practiceId: outcome.practiceId, slug, schema: outcome.schema, role: outcome.role }
  return { ...practice, drop: () => dropTestPractice(urls, practice) }
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

/** Vitest globalSetup (vitest.config.ts): every run of the database tests starts from an empty vetora_test. */
export async function setup(): Promise<void> {
  if (!databaseTestsEnabled()) {
    // A skipped database suite must never pass CI by accident (.github/workflows/ci.yml sets both variables).
    if (process.env.CI) {
      throw setupFailure('CI must set DATABASE_URL_MIGRATOR and DATABASE_URL_DIRECT so the database tests run')
    }
    return
  }
  try {
    await resetTestDatabase()
  } catch (error) {
    throw setupFailure(`vetora_test could not be reset (is the compose Postgres up? pnpm local:up): ${reason(error)}`)
  }
}

/** The message behind a connection failure; Node reports both loopback addresses as one AggregateError. */
function reason(error: unknown): string {
  if (error instanceof AggregateError && error.errors.length > 0) return reason(error.errors[0])
  if (error instanceof Error) return error.message || error.name
  return String(error)
}

/**
 * An error Vitest prints as its message alone. With a stack to map, Vitest 5 on Vite 8 crashes in its source map
 * step ("code.charCodeAt is not a function") for an error thrown from a globalSetup, and the reason is lost.
 */
function setupFailure(message: string): Error {
  const error = new Error(message)
  error.stack = message
  return error
}
