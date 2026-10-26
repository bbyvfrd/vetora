import { describe, expect, it } from 'vitest'
import { formsPaths, isFormsObject, keyPaths, missingForms } from './plurals.js'

/**
 * Counted nouns (spec #9, "Counts"): a noun's plural forms sit as one object under one key, read by the design
 * system's formatCount. These fixtures prove the checker the live resources run through in index.test.ts.
 */
describe('isFormsObject(), a counted noun’s forms under one key', () => {
  it('recognises an object whose keys are plural categories and whose values are strings', () => {
    expect(isFormsObject({ one: 'patient', other: 'patients' })).toBe(true)
    expect(isFormsObject({ other: 'pasiyent' })).toBe(true)
    expect(isFormsObject({ one: 'пациент', few: 'пациента', many: 'пациентов' })).toBe(true)
  })

  it('does not mistake a group of keys, an empty object, a string or an array for one', () => {
    expect(isFormsObject({ title: 'API status', retry: 'Try again' })).toBe(false)
    expect(isFormsObject({ one: 'patient', title: 'Patients' })).toBe(false)
    expect(isFormsObject({})).toBe(false)
    expect(isFormsObject('patients')).toBe(false)
    expect(isFormsObject(['patient', 'patients'])).toBe(false)
    expect(isFormsObject({ one: 1 })).toBe(false)
  })

  it('knows only the four forms the design system’s plural() picks from, so a zero or two form is a plain key', () => {
    expect(isFormsObject({ zero: 'no patients', other: 'patients' })).toBe(false)
  })
})

describe('missingForms(), the forms each language needs: other in Azerbaijani, one, few and many in Russian, one and other in English', () => {
  it('passes a noun that carries them, one that carries more, and a resource with no counted noun at all', () => {
    expect(missingForms({ patients: { other: 'pasiyent' } }, 'az')).toEqual([])
    expect(missingForms({ patients: { one: 'pasiyent', other: 'pasiyent' } }, 'az')).toEqual([])
    expect(missingForms({ patients: { one: 'пациент', few: 'пациента', many: 'пациентов' } }, 'ru')).toEqual([])
    expect(missingForms({ patients: { one: 'patient', other: 'patients' } }, 'en')).toEqual([])
    expect(missingForms({ health: { title: 'Состояние API', retry: 'Повторить' } }, 'ru')).toEqual([])
  })

  it('names the key path and the forms a noun lacks, in the order its language lists them', () => {
    expect(missingForms({ patients: { one: 'пациент', other: 'пациентов' } }, 'ru')).toEqual(['patients: few, many'])
    expect(missingForms({ list: { patients: { other: 'patients' } } }, 'en')).toEqual(['list.patients: one'])
    expect(missingForms({ patients: { one: 'pasiyent' } }, 'az')).toEqual(['patients: other'])
  })
})

describe('keyPaths() and formsPaths(), a counted noun as one key', () => {
  const en = { health: { title: 'API status' }, list: { patients: { one: 'patient', other: 'patients' } } }
  const az = { health: { title: 'API vəziyyəti' }, list: { patients: { other: 'pasiyent' } } }

  it('lists every key once, a counted noun as one key whatever forms its language gives it', () => {
    expect(keyPaths(en)).toEqual(['health.title', 'list.patients'])
    expect(keyPaths(az)).toEqual(keyPaths(en))
  })

  it('lists where the counted nouns are, so a language that spells one as a plain string is told apart', () => {
    expect(formsPaths(en)).toEqual(['list.patients'])
    expect(formsPaths({ health: { title: 'API status' }, list: { patients: 'patients' } })).toEqual([])
  })
})
