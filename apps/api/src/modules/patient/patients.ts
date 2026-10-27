import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import type { LangCode } from '../../platform/db/domains.js'
import { violatedKeyOf } from '../../platform/db/errors.js'
import { practiceToday } from '../../platform/db/platform-tables.js'
import { practiceContext } from '../../platform/request-context.js'
import { breed, ownership, patient, type SEXES, species } from './schema.js'

/**
 * The Patient module's work for a request (spec #18, "Tables": the patient module; #21): the species with their breeds,
 * a breed added inline, a patient registered with its owner from the practice's today, and the patients a client
 * currently owns. Everything runs in the request's transaction (practiceContext()), as the actor.
 */

type BreedNames = { az: string | null; ru: string | null; en: string | null }

const breedNamesOf = (row: { nameAz: string | null; nameRu: string | null; nameEn: string | null }): BreedNames => ({
  az: row.nameAz,
  ru: row.nameRu,
  en: row.nameEn,
})

/** Every species in its order, each with its active breeds. */
export async function listSpecies() {
  const { db } = practiceContext()
  const rows = await db.select().from(species).orderBy(asc(species.sort), asc(species.code))
  const breeds = await db
    .select()
    .from(breed)
    .where(eq(breed.active, true))
    .orderBy(asc(breed.nameRu), asc(breed.nameAz), asc(breed.nameEn))
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: { az: row.nameAz, ru: row.nameRu, en: row.nameEn },
    clinicallySupported: row.clinicallySupported,
    breeds: breeds
      .filter((item) => item.speciesId === row.id)
      .map((item) => ({ id: item.id, name: breedNamesOf(item) })),
  }))
}

export type BreedInput = { id: string; speciesId: string; language: LangCode; name: string }

export type BreedOutcome =
  | { status: 'created' | 'existing'; breed: { id: string; speciesId: string; name: BreedNames } }
  | { status: 'no-species' }
  /** The species already has a breed of this Russian name (spec 0002: unique per species and Russian name). */
  | { status: 'name-taken' }

/** Add a breed with one name in `language`; the same id again answers the breed as it stands and changes nothing. */
export async function addBreed(input: BreedInput): Promise<BreedOutcome> {
  const { db } = practiceContext()
  const [stored] = await db.select().from(breed).where(eq(breed.id, input.id))
  if (stored)
    return { status: 'existing', breed: { id: stored.id, speciesId: stored.speciesId, name: breedNamesOf(stored) } }
  const [known] = await db.select({ id: species.id }).from(species).where(eq(species.id, input.speciesId))
  if (!known) return { status: 'no-species' }
  try {
    const [created] = await db
      .insert(breed)
      .values({
        id: input.id,
        speciesId: input.speciesId,
        nameAz: input.language === 'az' ? input.name : null,
        nameRu: input.language === 'ru' ? input.name : null,
        nameEn: input.language === 'en' ? input.name : null,
      })
      .returning()
    if (!created) throw new Error('breed insert returned no row')
    return { status: 'created', breed: { id: created.id, speciesId: created.speciesId, name: breedNamesOf(created) } }
  } catch (error) {
    if (violatedKeyOf(error) === 'breed_species_name_ru_idx') return { status: 'name-taken' }
    throw error
  }
}

export type PatientInput = {
  id: string
  name: string
  speciesId: string
  breedId?: string | null
  sex: (typeof SEXES)[number]
  birthDate?: string | null
  birthDateIsEstimate: boolean
  isNeutered: boolean
  colour?: string | null
  microchipNumber?: string | null
  /** The client who owns the patient from the practice's today. */
  ownerId: string
}

export type PatientOutcome =
  /** Written now, with its owner row; or already there, owned by that client (a retry). */
  | { status: 'created' | 'existing' }
  /** The id names a patient the client does not own now. */
  | { status: 'not-owned' }
  | { status: 'microchip-taken' }
  | { status: 'birth-date-in-future' }
  | { status: 'no-species' | 'no-breed' }

/**
 * Register a patient and its owner row from the practice's today (spec #18, "Tables": registering a patient writes its
 * owner row from today), in the request's transaction. The same id again changes nothing.
 */
export async function registerPatient(input: PatientInput): Promise<PatientOutcome> {
  const { db } = practiceContext()
  const [existing] = await db.select({ id: patient.id }).from(patient).where(eq(patient.id, input.id))
  if (existing) return (await ownsPatient(input.ownerId, input.id)) ? { status: 'existing' } : { status: 'not-owned' }
  const { rows } = await db.execute<{ today: string | null }>(sql`select ${practiceToday()}::text as today`)
  const today = rows[0]?.today
  // Fail closed: without the practice's today no birth date can be checked against it.
  if (!today) throw new Error('the practice has no settings row to read its time zone from')
  if (input.birthDate && input.birthDate > today) return { status: 'birth-date-in-future' }
  const [known] = await db.select({ id: species.id }).from(species).where(eq(species.id, input.speciesId))
  if (!known) return { status: 'no-species' }
  if (input.breedId) {
    const [ofSpecies] = await db
      .select({ id: breed.id })
      .from(breed)
      .where(and(eq(breed.id, input.breedId), eq(breed.speciesId, input.speciesId)))
    if (!ofSpecies) return { status: 'no-breed' }
  }
  try {
    await db.insert(patient).values({
      id: input.id,
      name: input.name,
      speciesId: input.speciesId,
      breedId: input.breedId || null,
      sex: input.sex,
      birthDate: input.birthDate || null,
      birthDateIsEstimate: Boolean(input.birthDate) && input.birthDateIsEstimate,
      isNeutered: input.isNeutered,
      colour: input.colour || null,
      microchipNumber: input.microchipNumber || null,
    })
  } catch (error) {
    if (violatedKeyOf(error) === 'patient_microchip_number_idx') return { status: 'microchip-taken' }
    throw error
  }
  await db.insert(ownership).values({
    patientId: input.id,
    clientId: input.ownerId,
    role: 'owner',
    validFrom: practiceToday(),
  })
  return { status: 'created' }
}

/** The owner rows that hold today: started, and not yet ended. */
const ownsToday = () =>
  and(
    eq(ownership.role, 'owner'),
    lte(ownership.validFrom, practiceToday()),
    or(isNull(ownership.validTo), gt(ownership.validTo, practiceToday())),
  )

/** Whether the client is the patient's owner today. */
export async function ownsPatient(clientId: string, patientId: string): Promise<boolean> {
  const { db } = practiceContext()
  const [row] = await db
    .select({ id: ownership.id })
    .from(ownership)
    .where(and(eq(ownership.patientId, patientId), eq(ownership.clientId, clientId), ownsToday()))
  return row !== undefined
}

export type OwnedPatient = {
  id: string
  name: string
  speciesId: string
  breedId: string | null
  sex: (typeof SEXES)[number]
}

/** What a patient header shows of a patient (#22): its name, species and breed names, sex, neuter state and birth date. */
export async function patientCard(id: string) {
  const { db } = practiceContext()
  const [row] = await db
    .select({ patient, species, breed })
    .from(patient)
    .innerJoin(species, eq(species.id, patient.speciesId))
    .leftJoin(breed, eq(breed.id, patient.breedId))
    .where(eq(patient.id, id))
  if (!row) return undefined
  return {
    id: row.patient.id,
    name: row.patient.name,
    species: { az: row.species.nameAz, ru: row.species.nameRu, en: row.species.nameEn },
    breed: row.breed ? breedNamesOf(row.breed) : null,
    sex: row.patient.sex,
    isNeutered: row.patient.isNeutered,
    birthDate: row.patient.birthDate,
    birthDateIsEstimate: row.patient.birthDateIsEstimate,
  }
}

/** The patients' names by id (#22: the rows of Visits today). */
export async function patientNames(ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const { db } = practiceContext()
  const rows = await db
    .select({ id: patient.id, name: patient.name })
    .from(patient)
    .where(inArray(patient.id, [...ids]))
  return new Map(rows.map((row) => [row.id, row.name]))
}

/** The active, living patients each client owns today, by client id, in the order they were registered. */
export async function patientsOwnedBy(clientIds: readonly string[]): Promise<Map<string, OwnedPatient[]>> {
  const owned = new Map<string, OwnedPatient[]>()
  if (clientIds.length === 0) return owned
  const { db } = practiceContext()
  const rows = await db
    .select({
      clientId: ownership.clientId,
      id: patient.id,
      name: patient.name,
      speciesId: patient.speciesId,
      breedId: patient.breedId,
      sex: patient.sex,
    })
    .from(ownership)
    .innerJoin(patient, eq(patient.id, ownership.patientId))
    .where(
      and(
        inArray(ownership.clientId, [...clientIds]),
        ownsToday(),
        eq(patient.status, 'active'),
        eq(patient.lifeStatus, 'alive'),
      ),
    )
    .orderBy(asc(patient.createdAt), asc(patient.id))
  for (const { clientId, ...row } of rows) owned.set(clientId, [...(owned.get(clientId) ?? []), row])
  return owned
}
