import { and, asc, desc, eq, isNull, ne, or } from 'drizzle-orm'
import { staffMember } from '../../platform/db/platform-tables.js'
import { practiceContext } from '../../platform/request-context.js'
import { clinicalObservation, encounter, type OBSERVATION_KINDS } from './schema.js'

/**
 * The vital signs of a visit (#23; spec #18, "Tables": `clinical_observation`): a reading recorded on a visit as the
 * actor, timed now at the request's location, the visit's readings, and the patient's last weight. Everything runs in
 * the request's transaction (practiceContext()). The database holds the rules whatever this code does: value, unit,
 * time and measurer required and each kind in its unit (CR-3), no change to a reading through the practice role
 * (PT-2), and no reading on a finalised visit (lock_parent(), CR-1, AC-2), which surfaces as the request's 409.
 */

export type ObservationKind = (typeof OBSERVATION_KINDS)[number]

/** A reading as the API answers it. */
export type ObservationRow = {
  id: string
  kind: ObservationKind
  value: number
  unit: string
  occurredAt: Date
  measuredBy: { id: string; displayName: string }
}

export type RecordOutcome =
  /** Written now; or already there for this visit (a retry), as it was written. */
  | { status: 'recorded' | 'existing'; observation: ObservationRow }
  /** No such visit, or a cancelled one. */
  | { status: 'missing' }
  /** The id names a reading of another visit, or one with no visit. */
  | { status: 'taken' }

/** What a reading is read with: the reading, its visit, and its measurer's name. */
const columns = {
  id: clinicalObservation.id,
  encounterId: clinicalObservation.encounterId,
  kind: clinicalObservation.kind,
  value: clinicalObservation.value,
  unit: clinicalObservation.unit,
  occurredAt: clinicalObservation.occurredAt,
  measuredById: clinicalObservation.measuredBy,
  measuredByName: staffMember.displayName,
}

/** A reading as `columns` selects it. */
type ReadingRow = NonNullable<Awaited<ReturnType<typeof readingById>>>

const answered = ({ measuredById, measuredByName, encounterId: _visit, ...row }: ReadingRow): ObservationRow => ({
  ...row,
  measuredBy: { id: measuredById, displayName: measuredByName },
})

/** One reading by its id, with its measurer's name and its visit; undefined when there is none. */
async function readingById(id: string) {
  const { db } = practiceContext()
  const [row] = await db
    .select(columns)
    .from(clinicalObservation)
    .innerJoin(staffMember, eq(staffMember.id, clinicalObservation.measuredBy))
    .where(eq(clinicalObservation.id, id))
  return row
}

/** A reading already stored under the id: the same answer for its own visit, a refusal for any other. */
const asRetry = (row: ReadingRow, encounterId: string): RecordOutcome =>
  row.encounterId === encounterId ? { status: 'existing', observation: answered(row) } : { status: 'taken' }

/**
 * Record a reading on a visit (spec #18: "record a reading on a visit"), measured by the actor, now, at the request's
 * location, for the visit's patient. The same id again changes nothing and answers the reading as stored. A completed
 * visit is refused by the database (vetora.frozen_record); a cancelled one reads as gone.
 */
export async function recordObservation(input: {
  id: string
  encounterId: string
  kind: ObservationKind
  value: number
  unit: string
}): Promise<RecordOutcome> {
  const { db, location, actor } = practiceContext()
  const stored = await readingById(input.id)
  if (stored) return asRetry(stored, input.encounterId)
  const [visit] = await db
    .select({ patientId: encounter.patientId, status: encounter.status })
    .from(encounter)
    .where(eq(encounter.id, input.encounterId))
  if (!visit || visit.status === 'discarded') return { status: 'missing' }
  const created = await db
    .insert(clinicalObservation)
    .values({
      id: input.id,
      locationId: location.id,
      patientId: visit.patientId,
      encounterId: input.encounterId,
      kind: input.kind,
      value: input.value,
      unit: input.unit,
      measuredBy: actor.id,
    })
    .onConflictDoNothing({ target: clinicalObservation.id })
    .returning({ id: clinicalObservation.id })
  const row = await readingById(input.id)
  // The key holds the row: written above, or by a request with the same id that came first.
  if (!row) throw new Error('a recorded reading is not there')
  return created.length > 0 ? { status: 'recorded', observation: answered(row) } : asRetry(row, input.encounterId)
}

/** The readings of a visit that is not cancelled, oldest first; undefined when there is no such visit. */
export async function visitObservations(encounterId: string): Promise<ObservationRow[] | undefined> {
  const { db } = practiceContext()
  const [visit] = await db
    .select({ status: encounter.status })
    .from(encounter)
    .where(and(eq(encounter.id, encounterId), ne(encounter.status, 'discarded')))
  if (!visit) return undefined
  const rows = await db
    .select(columns)
    .from(clinicalObservation)
    .innerJoin(staffMember, eq(staffMember.id, clinicalObservation.measuredBy))
    .where(eq(clinicalObservation.encounterId, encounterId))
    .orderBy(asc(clinicalObservation.occurredAt), asc(clinicalObservation.id))
  return rows.map(answered)
}

/**
 * The patient's last weight (spec #18: "the visit page reads the patient's last weight observation"): the newest
 * weight reading across their visits, or one taken with no visit; a cancelled visit's readings read as gone with it,
 * and so do `excludingVisit`'s, the visit page's own (story 41: the weight from before this visit, so a change shows).
 * Null when there is none.
 */
export async function lastWeight(patientId: string, excludingVisit?: string): Promise<ObservationRow | null> {
  const { db } = practiceContext()
  const [row] = await db
    .select(columns)
    .from(clinicalObservation)
    .innerJoin(staffMember, eq(staffMember.id, clinicalObservation.measuredBy))
    .leftJoin(encounter, eq(encounter.id, clinicalObservation.encounterId))
    .where(
      and(
        eq(clinicalObservation.patientId, patientId),
        eq(clinicalObservation.kind, 'weight'),
        or(
          isNull(clinicalObservation.encounterId),
          and(
            ne(encounter.status, 'discarded'),
            excludingVisit ? ne(clinicalObservation.encounterId, excludingVisit) : undefined,
          ),
        ),
      ),
    )
    .orderBy(desc(clinicalObservation.occurredAt), desc(clinicalObservation.id))
    .limit(1)
  return row ? answered(row) : null
}
