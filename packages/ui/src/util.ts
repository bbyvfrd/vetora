/** Join class names, skipping empty values. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/** The four meanings a status can have, plus neutral. */
export type Status = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

/** The filled icon that goes with each status. */
export const STATUS_ICON = {
  neutral: 'info',
  info: 'info',
  success: 'check_circle',
  warning: 'warning',
  danger: 'error',
} as const

const FOLD: Record<string, string> = { ə: 'e', ş: 's', ç: 'c', ğ: 'g', ö: 'o', ü: 'u', ı: 'i', ё: 'е' }

/** Lower-cases and drops Azerbaijani diacritics, so text typed on any keyboard still matches: "seker" finds "Şəkər". */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/̇/g, '')
    .replace(/[əşçğöüıё]/g, (c) => FOLD[c] || c)
}
