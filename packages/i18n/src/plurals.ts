import type { Language } from './index.js'

/**
 * Counted nouns (spec #9, "Counts"; ADR 0007; the artifact's formats.md): a noun's plural forms sit as one object
 * under one key in each locale file, holding the forms its language needs, and the design system's formatCount picks
 * the right one. This module names those forms and checks a resource for them; index.test.ts runs the check over the
 * live files.
 */

/** The forms the design system's plural() picks from (its PluralForms): a form under any other name is never shown. */
const categories: ReadonlySet<string> = new Set(['one', 'few', 'many', 'other'])

/**
 * The forms a counted noun carries in each language, as the design system's plural() reads them: an Azerbaijani noun
 * does not change after a number (5 pasiyent); Russian has 1 пациент, 2 пациента, 5 пациентов; English two forms.
 */
export const requiredForms: Record<Language, readonly string[]> = {
  az: ['other'],
  ru: ['one', 'few', 'many'],
  en: ['one', 'other'],
}

/** A counted noun's forms: an object with at least one key, every key a plural category and every value a string. */
export function isFormsObject(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const entries = Object.entries(value)
  return entries.length > 0 && entries.every(([category, form]) => categories.has(category) && typeof form === 'string')
}

/** A leaf of a resource under its dotted path: a string, or a counted noun's forms object taken whole. */
interface Leaf {
  path: string
  forms?: Record<string, string>
}

function leaves(resource: unknown, path = ''): Leaf[] {
  if (isFormsObject(resource)) return [{ path, forms: resource }]
  if (typeof resource !== 'object' || resource === null) return [{ path }]
  return Object.entries(resource).flatMap(([key, child]) => leaves(child, path ? `${path}.${key}` : key))
}

/** Every key of a resource as a dotted path, a counted noun's forms object counting as one key. */
export function keyPaths(resource: unknown): string[] {
  return leaves(resource).map((leaf) => leaf.path)
}

/** The dotted paths of a resource's counted nouns, so the languages can be checked to count the same ones. */
export function formsPaths(resource: unknown): string[] {
  return leaves(resource).flatMap((leaf) => (leaf.forms ? [leaf.path] : []))
}

/**
 * Names every counted noun of a language's resource that lacks a form its language needs, as "path.to.noun: few, many".
 * Empty when every noun carries its forms, and when the resource counts nothing yet.
 */
export function missingForms(resource: unknown, language: Language): string[] {
  return leaves(resource).flatMap(({ path, forms }) => {
    if (!forms) return []
    const missing = requiredForms[language].filter((form) => !(form in forms))
    return missing.length > 0 ? [`${path}: ${missing.join(', ')}`] : []
  })
}
