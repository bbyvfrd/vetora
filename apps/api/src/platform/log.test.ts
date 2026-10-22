import { DrizzleQueryError } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { rootCause, scrubError } from './log.js'

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
