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
