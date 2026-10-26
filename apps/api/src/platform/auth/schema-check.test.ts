import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * `auth check schema` (spec #18, "CI"; story 77): the hand written control tables and the Better Auth configuration
 * cannot drift apart. The CLI, as CI runs it, passes on the committed configuration with no database reachable and
 * refuses a configuration whose control table lost a column it writes (schema-check.fixture.ts).
 */

const API_DIR = fileURLToPath(new URL('../../..', import.meta.url))
const CLI = fileURLToPath(new URL('../../../node_modules/auth/dist/index.mjs', import.meta.url))

function checkSchema(config: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, 'check', 'schema', '--config', config], {
      cwd: API_DIR,
      env: {
        PATH: process.env.PATH ?? '',
        PUBLIC_ORIGIN: 'http://localhost:5173',
        BETTER_AUTH_SECRET: 'cli-only-secret-for-the-schema-check-0000',
        // Nothing listens on port 1: the check must not need a database.
        DATABASE_URL_POOLED: 'postgres://nobody:nobody@127.0.0.1:1/nowhere',
        DATABASE_URL_DIRECT: 'postgres://nobody:nobody@127.0.0.1:1/nowhere',
      },
    })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, output }))
  })
}

describe('auth check schema (spec #18, CI; story 77)', () => {
  it('passes on the committed configuration with no database to reach: exit 0', async () => {
    const run = await checkSchema('src/platform/auth/schema-check.ts')

    expect(run.output).toContain('Schema check passed against the configured Drizzle schema.')
    expect(run.code).toBe(0)
  }, 60_000)

  it('refuses a control table that lost a column the configuration writes, naming it: exit 1', async () => {
    const run = await checkSchema('src/platform/auth/schema-check.fixture.ts')

    expect(run.code).toBe(1)
    expect(run.output).toContain('language')
  }, 60_000)
})
