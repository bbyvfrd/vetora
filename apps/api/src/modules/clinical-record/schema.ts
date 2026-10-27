import { sql } from 'drizzle-orm'
import { type AnyPgColumn, check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { sqlList } from '../../platform/db/domains.js'
import { location, staffMember, standardColumns } from '../../platform/db/platform-tables.js'

/**
 * The Clinical Record tables (spec 0002, "Data model sketch": Clinical Record): `care_relationship` and `encounter`
 * (slice 1, #22), `clinical_observation` (#23), `encounter_diagnosis` and `encounter_amendment` (feature 12, ADR 0008).
 * What drizzle-kit does not model is written by hand in the migration: the keys to the Patient and Client modules'
 * tables, the set once trigger with its later moving column, the freeze, and the finalise trigger (CR-1, CR-2, CR-4).
 * `appointment_id`, `arrival_id` (slice 5) and `admission_id` (slice 8) arrive as nullable forward columns.
 */

/**
 * The veterinarian client patient relationship (docs/domain.md §7.3; CR-4): set once, so it ends by filling `ended_at`
 * and `ended_by` once, and `lapses_at` may only move later, as each finalised visit extends it. Current means open
 * (`ended_at` null) with `lapses_at` in the future; one open row per patient and veterinarian. `patient_id` is the
 * Patient module's table: a plain uuid here, the migration carries the REFERENCES (src/modules/README.md).
 */
export const careRelationship = pgTable(
  'care_relationship',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    patientId: uuid('patient_id').notNull(),
    veterinarianId: uuid('veterinarian_id')
      .notNull()
      .references(() => staffMember.id),
    establishedAt: timestamp('established_at', { withTimezone: true }).notNull(),
    establishedByEncounterId: uuid('established_by_encounter_id').references((): AnyPgColumn => encounter.id),
    /** Moved later by each finalised visit: its finalised_at plus practice_settings.care_relationship_lapse_months. */
    lapsesAt: timestamp('lapses_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endedBy: uuid('ended_by').references(() => staffMember.id),
    ...standardColumns(),
  },
  (table) => [
    check('care_relationship_lapses_check', sql`${table.lapsesAt} > ${table.establishedAt}`),
    check('care_relationship_ended_check', sql`(${table.endedAt} is null) = (${table.endedBy} is null)`),
    uniqueIndex('care_relationship_open_idx')
      .on(table.patientId, table.veterinarianId)
      .where(sql`${table.endedAt} is null`),
    index('care_relationship_patient_idx').on(table.patientId),
    index('care_relationship_veterinarian_idx').on(table.veterinarianId),
    index('care_relationship_encounter_idx').on(table.establishedByEncounterId),
    index('care_relationship_ended_by_idx').on(table.endedBy),
  ],
)

/** draft, then finalised (a vet completes it) or discarded (cancelled while a draft); the last two are final. */
export const ENCOUNTER_STATUSES = ['draft', 'finalised', 'discarded'] as const

/**
 * A visit (docs/domain.md §7.4: a screen says Visit, the model says Encounter), location scoped (IN-5) and frozen by
 * status: once finalised or discarded, the freeze_record() trigger refuses every change (CR-1, AC-2). The draft note
 * is its six text columns, saved by a versioned update. `client_id` and `reported_by_client_id` (CR-5: who told the
 * reason and the history) are the Client module's table, `patient_id` the Patient module's: plain uuids here.
 */
export const encounter = pgTable(
  'encounter',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    locationId: uuid('location_id')
      .notNull()
      .references(() => location.id),
    patientId: uuid('patient_id').notNull(),
    /** The responsible client at the time: the patient's owner when the visit starts. */
    clientId: uuid('client_id').notNull(),
    veterinarianId: uuid('veterinarian_id')
      .notNull()
      .references(() => staffMember.id),
    /** Set at completion: the current relationship the finalise trigger checks (CR-4, AC-14). */
    careRelationshipId: uuid('care_relationship_id').references((): AnyPgColumn => careRelationship.id),
    status: text('status', { enum: ENCOUNTER_STATUSES }).notNull().default('draft'),
    /** The database clock when the visit starts. */
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    reasonForVisit: text('reason_for_visit'),
    /** Shown as History. */
    anamnesis: text('anamnesis'),
    reportedByClientId: uuid('reported_by_client_id'),
    examination: text('examination'),
    diagnosisText: text('diagnosis_text'),
    treatment: text('treatment'),
    recommendations: text('recommendations'),
    finalisedAt: timestamp('finalised_at', { withTimezone: true }),
    finalisedBy: uuid('finalised_by').references(() => staffMember.id),
    ...standardColumns(),
  },
  (table) => [
    check('encounter_status_check', sql`${table.status} in (${sqlList(ENCOUNTER_STATUSES)})`),
    /** A finalised visit names when and by whom, and only a finalised one does. */
    check(
      'encounter_finalised_check',
      sql`(${table.status} = 'finalised') = (${table.finalisedAt} is not null) and (${table.finalisedAt} is null) = (${table.finalisedBy} is null)`,
    ),
    check('encounter_ended_check', sql`${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt}`),
    /** CR-5: the reason and the history are the reporter's words, so text in either names who told it. */
    check(
      'encounter_reporter_check',
      sql`${table.reportedByClientId} is not null or not (coalesce(${table.reasonForVisit}, '') ~ '\\S' or coalesce(${table.anamnesis}, '') ~ '\\S')`,
    ),
    /** Visits today: a location's visits by when they started. */
    index('encounter_location_started_idx').on(table.locationId, table.startedAt),
    index('encounter_patient_idx').on(table.patientId),
    index('encounter_client_idx').on(table.clientId),
    index('encounter_veterinarian_idx').on(table.veterinarianId),
    index('encounter_care_relationship_idx').on(table.careRelationshipId),
    index('encounter_reported_by_idx').on(table.reportedByClientId),
    index('encounter_finalised_by_idx').on(table.finalisedBy),
  ],
)
