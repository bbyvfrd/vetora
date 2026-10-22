import { describe, expect, it } from 'vitest'
import { HealthResponse } from './health.js'

describe('HealthResponse', () => {
  const valid = { status: 'ok', version: 'dev', database: 'ok', time: '2026-10-22T12:00:00.000Z' }

  it('accepts the shape the API returns', () => {
    expect(HealthResponse.parse(valid)).toEqual(valid)
  })

  it('rejects an unknown status, an unknown database state, and a time that is not ISO 8601', () => {
    expect(HealthResponse.safeParse({ ...valid, status: 'down' }).success).toBe(false)
    expect(HealthResponse.safeParse({ ...valid, database: 'slow' }).success).toBe(false)
    expect(HealthResponse.safeParse({ ...valid, time: '22.10.2026' }).success).toBe(false)
  })
})
