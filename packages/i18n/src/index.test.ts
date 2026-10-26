import { describe, expect, it } from 'vitest'
import { defaultLanguage, isLanguage, languageNames, languages, resources } from './index.js'
import { formsPaths, keyPaths, missingForms } from './plurals.js'

describe('@vetora/i18n', () => {
  it('ships az, ru, and en, with az as the default', () => {
    expect(languages).toEqual(['az', 'ru', 'en'])
    expect(defaultLanguage).toBe('az')
    expect(Object.keys(languageNames)).toEqual([...languages])
  })

  it('has every translation key in every language, a counted noun as one key', () => {
    const reference = keyPaths(resources.en.translation).sort()
    for (const language of languages) {
      expect(keyPaths(resources[language].translation).sort(), language).toEqual(reference)
    }
  })

  it('counts the same nouns in every language, each with the forms its language needs (spec #9, "Counts")', () => {
    const reference = formsPaths(resources.en.translation).sort()
    for (const language of languages) {
      expect(formsPaths(resources[language].translation).sort(), language).toEqual(reference)
      expect(missingForms(resources[language].translation, language), language).toEqual([])
    }
  })

  it('recognises only the three languages', () => {
    expect(isLanguage('ru')).toBe(true)
    expect(isLanguage('de')).toBe(false)
    expect(isLanguage(undefined)).toBe(false)
  })
})
