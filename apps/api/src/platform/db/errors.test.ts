import { describe, expect, it } from 'vitest'
import { INCOMPLETE_RULE_CODE, missingRowOf, ruleErrors, ruleOf } from './errors.js'

/** A Postgres error as pg raises it, wrapped the way Drizzle wraps a failed query: the cause chain rootCause() walks. */
const wrapped = (code: string, message: string) =>
  new Error('Failed query: update …', { cause: Object.assign(new Error(message), { code }) })

describe('the rule errors map a failed statement or commit to its rule by code (spec 0002, Interface surface)', () => {
  it('every rule has a code of its own in the VT class, apart from the one the deferred checks share', () => {
    const codes = Object.values(ruleErrors)
    expect(new Set(codes).size).toBe(codes.length)
    for (const code of codes) expect(code).toMatch(/^VT\d{3}$/)
    expect(codes).not.toContain(INCOMPLETE_RULE_CODE)
  })

  it('ruleOf() reads the code at the root of the cause chain; a deferred check names its rule in the message and missingRowOf() the row it found missing', () => {
    expect(ruleOf(wrapped('VT003', 'vetora.frozen_record: encounter is finalised and treatment cannot change'))).toBe(
      'vetora.frozen_record',
    )
    const incomplete = wrapped(INCOMPLETE_RULE_CODE, 'vetora.incomplete_dispense: stock_movement')
    expect(ruleOf(incomplete)).toBe('vetora.incomplete_dispense')
    expect(missingRowOf(incomplete)).toBe('stock_movement')
    // Not a rule: another SQLSTATE, the family code without the message shape, no Postgres error at the root at all.
    expect(ruleOf(wrapped('23514', 'new row violates check constraint'))).toBeUndefined()
    expect(missingRowOf(wrapped('VT003', 'vetora.frozen_record: fixture_record is finalised'))).toBeUndefined()
    expect(ruleOf(wrapped(INCOMPLETE_RULE_CODE, 'something else'))).toBeUndefined()
    expect(missingRowOf(wrapped(INCOMPLETE_RULE_CODE, 'something else'))).toBeUndefined()
    expect(ruleOf(new Error('no code'))).toBeUndefined()
    expect(ruleOf(undefined)).toBeUndefined()
  })
})
