import { and, desc, eq, gt, isNull, ne, or, sql } from 'drizzle-orm'
import { practiceSettings, practiceToday, staffMember } from '../../platform/db/platform-tables.js'
import { practiceContext } from '../../platform/request-context.js'
import { careRelationship, encounter } from './schema.js'

/**
 * The Clinical Record module's work for a request (spec #18, "Visit and money behaviour"; #22): a visit started, its
 * draft note saved against its version, completed with the care relationship it needs, or cancelled while a draft,
 * and the day's visits at a location. Everything runs in the request's transaction (practiceContext()), as the actor.
 * The database holds the rules whatever this code does: the finalise trigger (CR-2, CR-4, the reason and its reporter)
 * and the freeze (CR-1); a refusal there surfaces as the request's 409 naming the rule.
 */

/** The six sections of a note as the API carries them, blank as an empty string. */
export type NoteText = {
  reasonForVisit: string
  anamnesis: string
  examination: string
  diagnosis: string
  treatment: string
  recommendations: string
}

/** How a change against a version ended: the new version, a stale version, or no such visit (or a cancelled one). */
export type ChangeOutcome = { status: 'changed'; version: number } | { status: 'stale' } | { status: 'missing' }

export type StartOutcome =
  /** Written now; or already there for this patient (a retry). */
  | 'started'
  | 'existing'
  /** The id names a visit of another patient. */
  | 'taken'

/**
 * Start a draft visit (spec #18: Start visit) as the actor, its veterinarian, at the request's location, now; `clientId`
 * is the patient's owner, its client and the reporter of what the note will say they told (CR-5). The same id again
 * changes nothing.
 */
export async function startEncounter(input: {
  id: string
  patientId: string
  clientId: string
}): Promise<StartOutcome> {
  const { db, location, actor } = practiceContext()
  const created = await db
    .insert(encounter)
    .values({
      id: input.id,
      locationId: location.id,
      patientId: input.patientId,
      clientId: input.clientId,
      reportedByClientId: input.clientId,
      veterinarianId: actor.id,
    })
    .onConflictDoNothing({ target: encounter.id })
    .returning({ id: encounter.id })
  if (created.length > 0) return 'started'
  const [stored] = await db.select({ patientId: encounter.patientId }).from(encounter).where(eq(encounter.id, input.id))
  return stored?.patientId === input.patientId ? 'existing' : 'taken'
}

/** Blank text is no text: the columns hold null, as the reporter check and the finalise trigger read them. */
const textOrNull = (value: string) => (value.trim() === '' ? null : value)

/** A visit that is not cancelled, with its veterinarian's name and its note; undefined when there is none. */
export async function readEncounter(id: string) {
  const { db } = practiceContext()
  const [row] = await db
    .select({ visit: encounter, veterinarianName: staffMember.displayName })
    .from(encounter)
    .innerJoin(staffMember, eq(staffMember.id, encounter.veterinarianId))
    .where(and(eq(encounter.id, id), ne(encounter.status, 'discarded')))
  if (!row) return undefined
  const { visit, veterinarianName } = row
  return {
    id: visit.id,
    // A cancelled visit was filtered out above.
    status: visit.status as 'draft' | 'finalised',
    version: visit.version,
    startedAt: visit.startedAt,
    finalisedAt: visit.finalisedAt,
    patientId: visit.patientId,
    clientId: visit.clientId,
    veterinarian: { id: visit.veterinarianId, displayName: veterinarianName },
    note: {
      reasonForVisit: visit.reasonForVisit ?? '',
      anamnesis: visit.anamnesis ?? '',
      examination: visit.examination ?? '',
      diagnosis: visit.diagnosisText ?? '',
      treatment: visit.treatment ?? '',
      recommendations: visit.recommendations ?? '',
    },
  }
}

/** Why a change against a version touched no row: a stale version, or no such visit (or a cancelled one). */
async function unchangedOutcome(id: string): Promise<ChangeOutcome> {
  const { db } = practiceContext()
  const [row] = await db.select({ status: encounter.status }).from(encounter).where(eq(encounter.id, id))
  if (!row || row.status === 'discarded') return { status: 'missing' }
  // The update matched no row although the visit stands: its version moved on.
  return { status: 'stale' }
}

/**
 * Save the six sections of a draft note (spec #18: the draft note's versioned save) against the version the person
 * read; the update bumps it. A completed visit is refused by the freeze (vetora.frozen_record).
 */
export async function saveNote(id: string, version: number, note: NoteText): Promise<ChangeOutcome> {
  const { db } = practiceContext()
  const [saved] = await db
    .update(encounter)
    .set({
      reasonForVisit: textOrNull(note.reasonForVisit),
      anamnesis: textOrNull(note.anamnesis),
      examination: textOrNull(note.examination),
      diagnosisText: textOrNull(note.diagnosis),
      treatment: textOrNull(note.treatment),
      recommendations: textOrNull(note.recommendations),
    })
    .where(and(eq(encounter.id, id), eq(encounter.version, version), ne(encounter.status, 'discarded')))
    .returning({ version: encounter.version })
  return saved ? { status: 'changed', version: saved.version } : unchangedOutcome(id)
}

/**
 * The care relationship a completion renews (CR-4, AC-14; spec 0002, "Value sourcing": Finalise an encounter), lapsing
 * the practice's lapse months from now: the patient's current one with the actor or, while delegation is on, with any
 * veterinarian of the practice, the actor's own first, locked and extended; else the actor's open one, lapsed, extended,
 * or a new one, in one statement on the one open row per patient and vet, so two completions at once cannot both
 * create one. Its id.
 */
async function renewCareRelationship(patientId: string, encounterId: string): Promise<string> {
  const { db, actor } = practiceContext()
  const lapses = sql`now() + make_interval(months => (select ${practiceSettings.careRelationshipLapseMonths} from ${practiceSettings}))`
  const [current] = await db
    .select({ id: careRelationship.id })
    .from(careRelationship)
    .innerJoin(staffMember, eq(staffMember.id, careRelationship.veterinarianId))
    .where(
      and(
        eq(careRelationship.patientId, patientId),
        isNull(careRelationship.endedAt),
        gt(careRelationship.lapsesAt, sql`now()`),
        // As the finalise trigger reads delegation: a colleague's counts while they hold the veterinarian role.
        or(
          eq(careRelationship.veterinarianId, actor.id),
          and(
            sql`(select ${practiceSettings.delegationEnabled} from ${practiceSettings})`,
            sql`'veterinarian' = any(${staffMember.roles})`,
          ),
        ),
      ),
    )
    .orderBy(sql`${careRelationship.veterinarianId} = ${actor.id} desc`, desc(careRelationship.lapsesAt))
    .limit(1)
    .for('update', { of: careRelationship })
  if (current) {
    // lapses_at only moves later (the set once class); a shorter lapse setting leaves it where it was.
    await db
      .update(careRelationship)
      .set({ lapsesAt: sql`greatest(${careRelationship.lapsesAt}, ${lapses})` })
      .where(eq(careRelationship.id, current.id))
    return current.id
  }
  const [row] = await db
    .insert(careRelationship)
    .values({
      patientId,
      veterinarianId: actor.id,
      establishedAt: sql`now()`,
      establishedByEncounterId: encounterId,
      lapsesAt: lapses,
    })
    .onConflictDoUpdate({
      target: [careRelationship.patientId, careRelationship.veterinarianId],
      targetWhere: sql`${careRelationship.endedAt} is null`,
      // lapses_at only moves later (the set once class); a shorter lapse setting leaves it where it was.
      set: { lapsesAt: sql`greatest(${careRelationship.lapsesAt}, excluded.lapses_at)` },
    })
    .returning({ id: careRelationship.id })
  if (!row) throw new Error('care relationship upsert returned no row')
  return row.id
}

/**
 * Complete a visit (spec #18: Complete visit) against the version the person read: the visit locked, the care
 * relationship renewed, then `finalised_at`, `finalised_by` and `ended_at` set at once, which the finalise trigger
 * checks and the freeze then holds. A blank reason, or a visit already final, is the database's refusal, and the
 * request's rollback takes the relationship with it.
 */
export async function completeEncounter(id: string, version: number): Promise<ChangeOutcome> {
  const { db, actor } = practiceContext()
  const [visit] = await db
    .select({ status: encounter.status, version: encounter.version, patientId: encounter.patientId })
    .from(encounter)
    .where(eq(encounter.id, id))
    .for('update')
  if (!visit || visit.status === 'discarded') return { status: 'missing' }
  if (visit.version !== version) return { status: 'stale' }
  const careRelationshipId = visit.status === 'draft' ? await renewCareRelationship(visit.patientId, id) : undefined
  const [done] = await db
    .update(encounter)
    .set({
      status: 'finalised',
      finalisedAt: sql`now()`,
      finalisedBy: actor.id,
      endedAt: sql`now()`,
      careRelationshipId,
    })
    .where(eq(encounter.id, id))
    .returning({ version: encounter.version })
  if (!done) throw new Error('the locked visit was not updated')
  return { status: 'changed', version: done.version }
}

/** Cancel a draft visit opened by mistake (spec #18: Cancel visit): it is discarded, and a completed one is frozen. */
export async function cancelEncounter(id: string, version: number): Promise<ChangeOutcome> {
  const { db } = practiceContext()
  const [cancelled] = await db
    .update(encounter)
    .set({ status: 'discarded' })
    .where(and(eq(encounter.id, id), eq(encounter.version, version), ne(encounter.status, 'discarded')))
    .returning({ version: encounter.version })
  return cancelled ? { status: 'changed', version: cancelled.version } : unchangedOutcome(id)
}

/**
 * The visits started today at the request's location, newest first (spec #18: Visits today), the day being the
 * practice's, in its time zone: the range from its midnight to the next, so a visit just after midnight there, still
 * the day before in UTC, is today's. Cancelled visits are left out.
 */
export async function visitsToday() {
  const { db, location } = practiceContext()
  const zone = sql`(select ${practiceSettings.timeZone} from ${practiceSettings})`
  const { rows } = await db.execute<{ day: string | null }>(sql`select ${practiceToday()}::text as day`)
  const day = rows[0]?.day
  // Fail closed: without the practice's settings no day can be told.
  if (!day) throw new Error('the practice has no settings row to read its time zone from')
  const visits = await db
    .select({
      id: encounter.id,
      status: encounter.status,
      startedAt: encounter.startedAt,
      patientId: encounter.patientId,
      clientId: encounter.clientId,
      veterinarianId: encounter.veterinarianId,
      veterinarianName: staffMember.displayName,
    })
    .from(encounter)
    .innerJoin(staffMember, eq(staffMember.id, encounter.veterinarianId))
    .where(
      and(
        eq(encounter.locationId, location.id),
        ne(encounter.status, 'discarded'),
        sql`${encounter.startedAt} >= (${day}::date::timestamp at time zone ${zone})`,
        sql`${encounter.startedAt} < ((${day}::date + 1)::timestamp at time zone ${zone})`,
      ),
    )
    .orderBy(desc(encounter.startedAt), desc(encounter.id))
  return {
    day,
    visits: visits.map(({ veterinarianId, veterinarianName, status, ...visit }) => ({
      ...visit,
      status: status as 'draft' | 'finalised',
      veterinarian: { id: veterinarianId, displayName: veterinarianName },
    })),
  }
}
