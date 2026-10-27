import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  check,
  foreignKey,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
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
    /** The target of clinical_observation's key on its visit and patient together: a reading names its visit's patient. */
    uniqueIndex('encounter_id_patient_idx').on(table.id, table.patientId),
  ],
)

/** What a reading measures (spec 0002's sketch); the visit page records the first four (#23). */
export const OBSERVATION_KINDS = [
  'weight',
  'temperature',
  'pulse',
  'respiratory_rate',
  'body_condition',
  'other',
] as const

/**
 * A measured finding (docs/domain.md §7.3: ClinicalObservation; the vital signs of a visit), append only: a reading is
 * never changed, a correction is a new row and the newest is the one in force (PT-2, AC-6). Value, unit, time and
 * measurer are all required (CR-3), and each vital sign keeps its one unit: weight in kg, temperature in °C, pulse and
 * respiratory rate per minute. `occurred_at` is never in the future (the CHECK) and back datable within the practice's
 * limit (assert_backdate_limit(), AC-13); a reading on a finalised or discarded visit is refused by lock_parent() on
 * its encounter (CR-1, AC-2). Location scoped (IN-5). `encounter_id` is null for a weight taken with no visit (feature
 * 11); `patient_id` is the Patient module's table, a plain uuid here with its key in the migration.
 * `admission_id` arrives with slice 8 as a nullable forward column.
 */
export const clinicalObservation = pgTable(
  'clinical_observation',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    locationId: uuid('location_id')
      .notNull()
      .references(() => location.id),
    patientId: uuid('patient_id').notNull(),
    /** Keyed with `patient_id` to the visit's own pair, so a reading never names another patient's visit. */
    encounterId: uuid('encounter_id'),
    kind: text('kind', { enum: OBSERVATION_KINDS }).notNull(),
    value: numeric('value', { precision: 10, scale: 3, mode: 'number' }).notNull(),
    unit: text('unit').notNull(),
    /** When it was measured: the database clock unless the measurer says earlier, within the back dating limit. */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    measuredBy: uuid('measured_by')
      .notNull()
      .references(() => staffMember.id),
    note: text('note'),
    ...standardColumns(),
  },
  (table) => [
    check('clinical_observation_kind_check', sql`${table.kind} in (${sqlList(OBSERVATION_KINDS)})`),
    check(
      'clinical_observation_unit_check',
      sql`case ${table.kind} when 'weight' then ${table.unit} = 'kg' when 'temperature' then ${table.unit} = '°C' when 'pulse' then ${table.unit} = '/min' when 'respiratory_rate' then ${table.unit} = '/min' else ${table.unit} ~ '\\S' end`,
    ),
    check('clinical_observation_occurred_at_check', sql`${table.occurredAt} <= now()`),
    foreignKey({
      name: 'clinical_observation_encounter_patient_fkey',
      columns: [table.encounterId, table.patientId],
      foreignColumns: [encounter.id, encounter.patientId],
    }),
    /** The patient's last weight, and each kind's readings over time. */
    index('clinical_observation_patient_kind_idx').on(table.patientId, table.kind, table.occurredAt),
    index('clinical_observation_encounter_idx').on(table.encounterId),
    index('clinical_observation_location_idx').on(table.locationId),
    index('clinical_observation_measured_by_idx').on(table.measuredBy),
  ],
)
