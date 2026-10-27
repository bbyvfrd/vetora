import { parsePhoneNumberFromString } from 'libphonenumber-js'
import { z } from 'zod'

/**
 * Phone numbers (spec #18, "Contracts"): one shared function normalises what a person types to E.164, with Azerbaijan
 * as the default region, so `+994 50 123 45 67`, `050 123-45-67`, `(050) 123 45 67` and `994501234567` are one
 * number to the lookup and to registration alike. The display form comes from the design system's `formatPhone`.
 */

/** The region a number without a country code is read in. */
export const DEFAULT_PHONE_REGION = 'AZ'

/** The number in E.164 (`+994501234567`), or undefined when the text is not a valid phone number. */
export function normalisePhone(text: string): string | undefined {
  const parsed = parsePhoneNumberFromString(text, DEFAULT_PHONE_REGION)
  return parsed?.isValid() ? parsed.number : undefined
}

/** A phone number as a person types it; valid when normalisePhone() reads it. */
export const Phone = z
  .string()
  .trim()
  .max(40)
  .refine((text) => normalisePhone(text) !== undefined, { message: 'Not a phone number' })
export type Phone = z.infer<typeof Phone>
