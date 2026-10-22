import type { TranslationResource } from '@vetora/i18n'

declare module 'i18next' {
  interface CustomTypeOptions {
    resources: { translation: TranslationResource }
  }
}
