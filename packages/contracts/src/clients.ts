import { z } from 'zod'
import { Language } from './me.js'
import { Sex } from './patients.js'
import { Phone } from './phone.js'

/**
 * Finding a client by phone and registering a client and a pet (spec #18, "Contracts" and "Visit and money
 * behaviour": New visit's Save; #21). Names and phones travel in request bodies, never in a URL (spec 0001, "API
 * conventions"); creates carry a UUID v7 the client generates, so a retry changes nothing.
 */

/** POST /api/p/{practiceId}/clients/lookup request: the phone as the person typed it. */
export const PhoneLookup = z.object({ phone: Phone })
export type PhoneLookup = z.infer<typeof PhoneLookup>

/** A patient a client currently owns, as the lookup lists it. */
export const OwnedPatient = z.object({
  id: z.uuid(),
  name: z.string(),
  speciesId: z.uuid(),
  breedId: z.uuid().nullable(),
  sex: Sex,
})
export type OwnedPatient = z.infer<typeof OwnedPatient>

/** POST /api/p/{practiceId}/clients/lookup response: every client holding the number, each with their current patients. */
export const PhoneLookupResult = z.object({
  /** The number in E.164, as it is stored and matched. */
  phone: z.string(),
  /** None, one, or several: a family often shares one phone, so a second client on a number is warned about, never refused. */
  clients: z.array(
    z.object({
      id: z.uuid(),
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
      patronymic: z.string().nullable(),
      preferredLanguage: Language,
      patients: z.array(OwnedPatient),
    }),
  ),
})
export type PhoneLookupResult = z.infer<typeof PhoneLookupResult>

/** A person's or a patient's name: required, trimmed. */
const Name = z.string().trim().min(1).max(100)
/** An optional line of text; blank is the same as none. */
const OptionalText = z.string().trim().max(100).nullish()

/** A client or a patient already registered, by its id. */
export const Existing = z.object({ type: z.literal('existing'), id: z.uuid() })
export type Existing = z.infer<typeof Existing>

/** A client to register: a person, with one phone (spec #18; organisations are not on screen yet). */
export const NewClient = z.object({
  type: z.literal('new'),
  /** A UUID v7 the client generates. */
  id: z.uuidv7(),
  firstName: Name,
  /** Spec 0002: a person has a last name (the interviews may relax it). */
  lastName: Name,
  patronymic: OptionalText,
  phone: Phone,
  /** The language of the documents and messages the clinic gives the client. */
  preferredLanguage: Language,
})
export type NewClient = z.infer<typeof NewClient>

/** A patient to register, owned by the registration's client from the practice's today. */
export const NewPatient = z.object({
  type: z.literal('new'),
  /** A UUID v7 the client generates. */
  id: z.uuidv7(),
  name: Name,
  speciesId: z.uuid(),
  breedId: z.uuid().nullish(),
  sex: Sex,
  /** `YYYY-MM-DD`, not after the practice's today. */
  birthDate: z.iso.date().nullish(),
  /** The owner knows the birth date only roughly. */
  birthDateIsEstimate: z.boolean().default(false),
  isNeutered: z.boolean().default(false),
  colour: OptionalText,
  /** The 15 digits of an ISO microchip; one patient per microchip. */
  microchipNumber: z
    .string()
    .trim()
    .regex(/^\d{15}$/, 'The 15 digits of the microchip')
    .nullish(),
})
export type NewPatient = z.infer<typeof NewPatient>

/**
 * PUT /api/p/{practiceId}/registrations request: the client (an existing id, or a new client with its phone) and the
 * patient (an existing id the client owns, or a new one). What is new is written in one transaction, a new patient's
 * owner row from today with it; the same request again changes nothing.
 */
export const Registration = z.object({
  client: z.discriminatedUnion('type', [Existing, NewClient]),
  patient: z.discriminatedUnion('type', [Existing, NewPatient]),
})
export type Registration = z.infer<typeof Registration>

/** PUT /api/p/{practiceId}/registrations response: the two ids, registered. */
export const Registered = z.object({ clientId: z.uuid(), patientId: z.uuid() })
export type Registered = z.infer<typeof Registered>
