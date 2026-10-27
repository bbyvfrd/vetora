import { describe, expect, it } from 'vitest'
import { actionOfReading, NewObservation, VITAL_KINDS, VITAL_SIGNS } from './observations.js'

/** The plausible range of each vital sign is defined once here (#23; spec #18, "Contracts"); the API and the web read it. */
describe('a vital sign reading (#23)', () => {
  const accepted = [
    { kind: 'weight', value: 4.2, unit: 'kg' },
    { kind: 'temperature', value: 38.5, unit: '°C' },
    { kind: 'pulse', value: 90, unit: '/min' },
    { kind: 'respiratory_rate', value: 24, unit: '/min' },
  ] as const

  it.each(accepted)('accepts $kind in its unit', (reading) => {
    expect(NewObservation.safeParse(reading).success).toBe(true)
  })

  it('refuses a reading without a unit, or in another unit than its kind', () => {
    expect(NewObservation.safeParse({ kind: 'weight', value: 4.2 }).success).toBe(false)
    expect(NewObservation.safeParse({ kind: 'weight', value: 4.2, unit: 'lb' }).success).toBe(false)
    expect(NewObservation.safeParse({ kind: 'temperature', value: 38.5, unit: 'kg' }).success).toBe(false)
  })

  it.each([
    ['weight', 'kg', 0],
    ['weight', 'kg', 1000],
    ['temperature', '°C', 3.85],
    ['temperature', '°C', 385],
    ['pulse', '/min', 0],
    ['pulse', '/min', 9000],
    ['respiratory_rate', '/min', 0],
    ['respiratory_rate', '/min', 2400],
  ] as const)('refuses %s of %s outside its plausible range: %d', (kind, unit, value) => {
    expect(NewObservation.safeParse({ kind, value, unit }).success).toBe(false)
  })

  it('takes the ends of each range', () => {
    for (const kind of VITAL_KINDS) {
      const { unit, min, max } = VITAL_SIGNS[kind]
      expect(NewObservation.safeParse({ kind, value: min, unit }).success).toBe(true)
      expect(NewObservation.safeParse({ kind, value: max, unit }).success).toBe(true)
    }
  })

  it('refuses a value finer than the three decimals the table keeps', () => {
    expect(NewObservation.safeParse({ kind: 'weight', value: 4.2001, unit: 'kg' }).success).toBe(false)
  })

  it('needs the weight action for a weight and the vital signs action for the rest', () => {
    expect(actionOfReading('weight')).toBe('recordWeight')
    expect(actionOfReading('temperature')).toBe('recordVitalSignsAndNote')
    expect(actionOfReading('pulse')).toBe('recordVitalSignsAndNote')
    expect(actionOfReading('respiratory_rate')).toBe('recordVitalSignsAndNote')
  })
})
