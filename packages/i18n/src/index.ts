import az from './locales/az.json' with { type: 'json' }
import en from './locales/en.json' with { type: 'json' }
import ru from './locales/ru.json' with { type: 'json' }

/**
 * @vetora/i18n: the three UI languages and their resources, shared by the web app and,
 * later, the owner app (spec 0001, "Translations"). Keys live in src/locales/<lang>.json.
 */
export const languages = ['az', 'ru', 'en'] as const
export type Language = (typeof languages)[number]
export const defaultLanguage: Language = 'az'

/** Each language's name in itself, for a language switcher. */
export const languageNames: Record<Language, string> = {
  az: 'Azərbaycanca',
  ru: 'Русский',
  en: 'English',
}

export const resources = {
  az: { translation: az },
  ru: { translation: ru },
  en: { translation: en },
} as const

export type TranslationResource = typeof en

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (languages as readonly string[]).includes(value)
}
