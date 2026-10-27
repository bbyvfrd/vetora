import { z } from 'zod'
import { Language } from './me.js'
import { PracticePath } from './practice.js'

/**
 * The species and breeds a patient is registered with (spec #18, "Tables": the patient module; #21): the species seeded
 * by a migration, each with its three names, and the breeds a clinic adds inline with one name in the language it
 * works in.
 */

/** A catalog name in the three languages (spec 0002, "Conventions": Languages). */
export const Names = z.object({ az: z.string(), ru: z.string(), en: z.string() })
export type Names = z.infer<typeof Names>

/** A breed's names: at least one is present, the one it was added in. */
export const BreedNames = z.object({ az: z.string().nullable(), ru: z.string().nullable(), en: z.string().nullable() })
export type BreedNames = z.infer<typeof BreedNames>

export const Breed = z.object({
  id: z.uuid(),
  speciesId: z.uuid(),
  name: BreedNames,
})
export type Breed = z.infer<typeof Breed>

/** GET /api/p/{practiceId}/species response: every species in its order, each with its active breeds. */
export const SpeciesList = z.object({
  species: z.array(
    z.object({
      id: z.uuid(),
      /** A stable code: dog, cat, rabbit, bird, reptile, rodent, other. */
      code: z.string(),
      name: Names,
      /** Dog and cat; the rest are recorded only (OPEN-11). */
      clinicallySupported: z.boolean(),
      breeds: z.array(z.object({ id: z.uuid(), name: BreedNames })),
    }),
  ),
})
export type SpeciesList = z.infer<typeof SpeciesList>

/** The path of a breed create: its id, a UUID v7 the client generates, so a retry changes nothing (spec 0001). */
export const BreedPath = PracticePath.extend({ breedId: z.uuidv7() })
export type BreedPath = z.infer<typeof BreedPath>

/** PUT /api/p/{practiceId}/breeds/{breedId} request: a breed added inline, with one name in the language given. */
export const BreedCreate = z.object({
  speciesId: z.uuid(),
  /** The language the name is in: the person's interface language. */
  language: Language,
  name: z.string().trim().min(1).max(100),
})
export type BreedCreate = z.infer<typeof BreedCreate>

export const SEXES = ['male', 'female', 'unknown'] as const
export const Sex = z.enum(SEXES)
export type Sex = z.infer<typeof Sex>
