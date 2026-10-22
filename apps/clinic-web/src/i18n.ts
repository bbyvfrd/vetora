import { defaultLanguage, isLanguage, type Language, resources } from '@vetora/i18n'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'

const storageKey = 'vetora.language'

function storedLanguage(): Language {
  try {
    const value = localStorage.getItem(storageKey)
    return isLanguage(value) ? value : defaultLanguage
  } catch {
    return defaultLanguage
  }
}

const initial = storedLanguage()
document.documentElement.lang = initial

void i18next.use(initReactI18next).init({
  resources,
  lng: initial,
  fallbackLng: defaultLanguage,
  interpolation: { escapeValue: false },
})

/** Switches the UI language for this browser; the practice default language arrives with practice settings. */
export function setLanguage(language: Language): void {
  void i18next.changeLanguage(language)
  document.documentElement.lang = language
  try {
    localStorage.setItem(storageKey, language)
  } catch {
    // storage may be unavailable (private mode); the choice then lasts for this page load
  }
}

export { i18next }
