import type { Language } from '@vetora/i18n'

/** A person's full name as the clinic writes it: last name, first name, patronymic (New visit, Visits today, a visit). */
export const fullName = (client: { firstName: string | null; lastName: string | null; patronymic: string | null }) =>
  [client.lastName, client.firstName, client.patronymic].filter(Boolean).join(' ')

/** A catalog name in the screen's language, else in another: a breed added inline has only the one it was typed in. */
export const nameIn = (names: { az: string | null; ru: string | null; en: string | null }, language: string) =>
  names[language as Language] ?? names.az ?? names.ru ?? names.en ?? ''
