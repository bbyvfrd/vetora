import pg from 'pg'

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
