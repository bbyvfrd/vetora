import { describe, expect, it } from 'vitest'
import { defaultLanguage, isLanguage, languageNames, languages, resources } from './index.js'

function keyPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value).flatMap(([key, child]) => keyPaths(child, prefix ? `${prefix}.${key}` : key))
}

describe('@vetora/i18n', () => {
  it('ships az, ru, and en, with az as the default', () => {
    expect(languages).toEqual(['az', 'ru', 'en'])
    expect(defaultLanguage).toBe('az')
    expect(Object.keys(languageNames)).toEqual([...languages])
  })

  it('has every translation key in every language', () => {
    const reference = keyPaths(resources.en.translation).sort()
    for (const language of languages) {
      expect(keyPaths(resources[language].translation).sort(), language).toEqual(reference)
    }
  })

  it('recognises only the three languages', () => {
    expect(isLanguage('ru')).toBe(true)
    expect(isLanguage('de')).toBe(false)
    expect(isLanguage(undefined)).toBe(false)
  })
})
