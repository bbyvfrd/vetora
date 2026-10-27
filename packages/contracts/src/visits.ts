import { z } from 'zod'
import { Registered } from './clients.js'
import { BreedNames, Names, Sex } from './patients.js'
import { PracticeHeaders, PracticePath } from './practice.js'

/**
 * A visit and its note (spec #18, "Visit and money behaviour": Start visit, the draft note's versioned save, Complete
 * visit, Cancel visit, Visits today; #22). A screen says Visit where the model says Encounter (docs/domain.md §7.4).
 * Starting one carries the visit's UUID v7, so a retry changes nothing; every change to it after that carries the
 * version it was made against in `If-Match` and is refused with 412 when another change came first (spec 0001, "API
 * conventions").
 */

/** The path of a visit: its id, a UUID v7 the client generates when it starts the visit. */
export const VisitPath = PracticePath.extend({ visitId: z.uuidv7() })
export type VisitPath = z.infer<typeof VisitPath>

/** A version as the entity tag `If-Match` carries: the number in quotes, `"3"`. */
export const VersionTag = z.string().regex(/^"[1-9]\d*"$/, 'The version in quotes, such as "3"')

/** The `If-Match` value for a version. */
export const versionTag = (version: number): string => `"${version}"`

/** The version an `If-Match` value carries (validated by VersionTag). */
export const versionOfTag = (tag: string): number => Number(tag.slice(1, -1))

/** The headers of a change to a visit: the practice's, and the version the change was made against. */
export const VisitChangeHeaders = PracticeHeaders.extend({
  /** The visit's version as the person last read it, `"3"`: a change made against an older one answers 412. */
  'if-match': VersionTag,
})
export type VisitChangeHeaders = z.infer<typeof VisitChangeHeaders>

/** PUT /api/p/{practiceId}/visits/{visitId} response: the client, the patient and the visit, as started. */
export const VisitStarted = Registered.extend({ visitId: z.uuid() })
export type VisitStarted = z.infer<typeof VisitStarted>

/** One section of the note as typed: free text that may mix languages (spec 0002, "Languages"). */
const SectionText = z.string().max(20_000)

/**
 * The six sections of the note, in the order the vet works (docs/domain.md §7.1); a blank section is an empty string.
 * PUT /api/p/{practiceId}/visits/{visitId}/note request, and the note of a visit read.
 */
export const VisitNote = z.object({
  /** Required to complete the visit. */
  reasonForVisit: SectionText,
  /** Shown as History. */
  anamnesis: SectionText,
  examination: SectionText,
  diagnosis: SectionText,
  treatment: SectionText,
  recommendations: SectionText,
})
export type VisitNote = z.infer<typeof VisitNote>

/** draft while the note is written; finalised once a vet completed it, read only from then on. */
export const VisitStatus = z.enum(['draft', 'finalised'])
export type VisitStatus = z.infer<typeof VisitStatus>

/** A staff member as a visit names them. */
const StaffName = z.object({ id: z.uuid(), displayName: z.string() })

/** A client's name, as the clinic writes it: last name, first name, patronymic. */
const ClientName = z.object({
  id: z.uuid(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  patronymic: z.string().nullable(),
})

/** GET /api/p/{practiceId}/visits/{visitId} response: the visit with what its patient header shows. */
export const Visit = z.object({
  id: z.uuid(),
  status: VisitStatus,
  /** What the next change sends back in `If-Match`. */
  version: z.number().int().positive(),
  /** UTC instants, shown in the practice's time zone. */
  startedAt: z.iso.datetime(),
  finalisedAt: z.iso.datetime().nullable(),
  veterinarian: StaffName,
  patient: z.object({
    id: z.uuid(),
    name: z.string(),
    species: Names,
    breed: BreedNames.nullable(),
    sex: Sex,
    isNeutered: z.boolean(),
    /** `YYYY-MM-DD`. */
    birthDate: z.iso.date().nullable(),
    birthDateIsEstimate: z.boolean(),
  }),
  /** The visit's client: the patient's owner when it started. */
  owner: ClientName.extend({
    /** The primary phone as it was typed. */
    phone: z.string().nullable(),
  }),
  note: VisitNote,
})
export type Visit = z.infer<typeof Visit>

/** What a change to a visit answers: its new version. */
export const VisitVersion = z.object({ version: z.number().int().positive() })
export type VisitVersion = z.infer<typeof VisitVersion>

/** GET /api/p/{practiceId}/visits response: the day's visits at the request's location, newest first. */
export const VisitsToday = z.object({
  /** The practice's today, `YYYY-MM-DD`, in its time zone. */
  day: z.iso.date(),
  visits: z.array(
    z.object({
      id: z.uuid(),
      status: VisitStatus,
      startedAt: z.iso.datetime(),
      patient: z.object({ id: z.uuid(), name: z.string() }),
      client: ClientName,
      veterinarian: StaffName,
    }),
  ),
})
export type VisitsToday = z.infer<typeof VisitsToday>
