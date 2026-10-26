import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DrizzleQueryError } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { rootCause, scrubError } from './log.js'

describe('log', () => {
  it("writes each line before the next statement runs, so a command's result printed after its log is stdout's last line (on Linux, where a pipe is written at once, a buffered log crossed it in CI)", () => {
    // The real logger in a child process whose stdout blocks, as a pipe does on Linux, with a run's worth of earlier
    // lines still to write when the result is printed.
    const script = `
      import { log } from './src/platform/log.ts'
      process.stdout._handle?.setBlocking?.(true)
      for (let i = 0; i < 2000; i++) log.info({ step: i }, 'earlier line')
      log.info('staff member in place')
      console.log('the-result')
    `
    const run = spawnSync(process.execPath, ['--import=tsx', '--input-type=module', '--eval', script], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      env: { PATH: process.env.PATH ?? '', LOG_LEVEL: 'info' },
      encoding: 'utf8',
    })

    expect(run.stderr).toBe('')
    const lines = run.stdout.trim().split('\n')
    expect(lines).toHaveLength(2002)
    expect(lines.at(-1)).toBe('the-result')
  }, 30_000)
})

describe('scrubError', () => {
  it("drops a Postgres error's detail, hint, and where, down the cause chain Drizzle wraps it in", () => {
    const postgres = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      detail: 'Key (slug)=(alfa) already exists.',
      hint: 'a hint',
      where: 'SQL statement',
    })
    const wrapped = new Error('Failed query: insert into control.practice', { cause: postgres })

    const scrubbed = scrubError(wrapped) as Error & { cause: Record<string, unknown> }

    expect(scrubbed).toBe(wrapped)
    expect(scrubbed.cause).toMatchObject({ code: '23505', message: 'duplicate key value violates unique constraint' })
    expect(scrubbed.cause).not.toHaveProperty('detail')
    expect(scrubbed.cause).not.toHaveProperty('hint')
    expect(scrubbed.cause).not.toHaveProperty('where')
  })

  it('keeps the query params of a Drizzle query error out of its message, stack, and properties (no personal data in logs)', () => {
    const postgres = Object.assign(new Error('value too long for type character varying(10)'), { code: '22001' })
    const query = 'insert into "client" ("first_name", "phone") values ($1, $2)'
    const wrapped = new DrizzleQueryError(query, ['Aygün', '+994501234567'], postgres)

    const scrubbed = scrubError(wrapped) as DrizzleQueryError

    expect(scrubbed.message).toBe(`Failed query: ${query}`)
    expect(scrubbed.stack).toContain(`Failed query: ${query}`)
    expect(scrubbed.stack).not.toContain('Aygün')
    expect(scrubbed.stack).not.toContain('+994501234567')
    expect(scrubbed).not.toHaveProperty('params')
    expect(scrubbed.query).toBe(query)
    expect(scrubbed.cause).toBe(postgres)
  })

  it('leaves a value that is not an object alone', () => {
    expect(scrubError('boom')).toBe('boom')
    expect(scrubError(undefined)).toBeUndefined()
  })
})

describe('rootCause', () => {
  it("returns the Postgres error inside Drizzle's wrapper, or the value itself when nothing is wrapped", () => {
    const postgres = Object.assign(new Error('division by zero'), { code: '22012' })
    const wrapped = new Error('Failed query: select 1/0', { cause: postgres })

    expect(rootCause(wrapped)).toBe(postgres)
    expect(rootCause(postgres)).toBe(postgres)
    expect(rootCause('boom')).toBe('boom')
  })
})
