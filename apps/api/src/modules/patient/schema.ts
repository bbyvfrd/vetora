import { sql } from 'drizzle-orm'
import { boolean, check, date, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { sqlList } from '../../platform/db/domains.js'
import { standardColumns } from '../../platform/db/platform-tables.js'

/**
 * The Patient tables (spec 0002, "Data model sketch": Patient): `species`, `breed`, `patient`, `ownership` (the shared
 * kernel with Client, docs/domain.md §6.5; slice 1, #21), `patient_problem`, `patient_alert` (feature 12, ADR 0008).
 * The catalog names take the ICU collation of their language, and `ownership`'s one current owner per patient is an
 * exclusion constraint (AC-5), both written by hand in the migration, which drizzle-kit does not model.
 * `photo_file_id` arrives with `file` (slice 6), `import_batch_id` with `import_batch` (slice 7).
 */

/**
 * The species a patient can be, seeded by the practice set's species_seed migration: dog and cat clinically supported,
 * the rest recorded only (OPEN-11), so either answer of the interviews is a data change.
 */
export const species = pgTable('species', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  code: text('code').notNull().unique(),
  nameAz: text('name_az').notNull(),
  nameRu: text('name_ru').notNull(),
  nameEn: text('name_en').notNull(),
  clinicallySupported: boolean('clinically_supported').notNull().default(false),
  sort: integer('sort').notNull().default(0),
  ...standardColumns(),
})

/** A breed of a species, added by the clinic inline with one name in the current language (spec #18). */
export const breed = pgTable(
  'breed',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    speciesId: uuid('species_id')
      .notNull()
      .references(() => species.id),
    nameAz: text('name_az'),
    nameRu: text('name_ru'),
    nameEn: text('name_en'),
    active: boolean('active').notNull().default(true),
    ...standardColumns(),
  },
  (table) => [
    check('breed_name_check', sql`coalesce(${table.nameAz}, ${table.nameRu}, ${table.nameEn}) is not null`),
    index('breed_species_idx').on(table.speciesId),
    uniqueIndex('breed_species_name_ru_idx').on(table.speciesId, table.nameRu).where(sql`${table.nameRu} is not null`),
  ],
)

export const SEXES = ['male', 'female', 'unknown'] as const
export const LIFE_STATUSES = ['alive', 'deceased'] as const
export const PATIENT_STATUSES = ['active', 'archived'] as const

/** The animal (docs/domain.md §7). Death is a status (PT-4). */
export const patient = pgTable(
  'patient',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    name: text('name').notNull(),
    speciesId: uuid('species_id')
      .notNull()
      .references(() => species.id),
    breedId: uuid('breed_id').references(() => breed.id),
    sex: text('sex', { enum: SEXES }).notNull(),
    isNeutered: boolean('is_neutered').notNull().default(false),
    neuteredOn: date('neutered_on'),
    birthDate: date('birth_date'),
    birthDateIsEstimate: boolean('birth_date_is_estimate').notNull().default(false),
    colour: text('colour'),
    markings: text('markings'),
    microchipNumber: text('microchip_number'),
    passportNumber: text('passport_number'),
    lifeStatus: text('life_status', { enum: LIFE_STATUSES }).notNull().default('alive'),
    deceasedOn: date('deceased_on'),
    status: text('status', { enum: PATIENT_STATUSES }).notNull().default('active'),
    notes: text('notes'),
    ...standardColumns(),
  },
  (table) => [
    check('patient_sex_check', sql`${table.sex} in (${sqlList(SEXES)})`),
    check('patient_life_status_check', sql`${table.lifeStatus} in (${sqlList(LIFE_STATUSES)})`),
    check('patient_status_check', sql`${table.status} in (${sqlList(PATIENT_STATUSES)})`),
    index('patient_species_idx').on(table.speciesId),
    index('patient_breed_idx').on(table.breedId),
    uniqueIndex('patient_microchip_number_idx')
      .on(table.microchipNumber)
      .where(sql`${table.microchipNumber} is not null`),
  ],
)

export const OWNERSHIP_ROLES = ['owner', 'authorised_person'] as const

/**
 * Who stands for a patient and from when (docs/domain.md §6.5, the shared kernel): set once, so a period ends by
 * filling `valid_to` and a new row begins the next. One current owner per patient is the exclusion constraint
 * `ownership_one_owner` of the migration (AC-5, PT-1). `client_id` is the Client module's table: a plain uuid here, the
 * migration carries the REFERENCES (src/modules/README.md).
 */
export const ownership = pgTable(
  'ownership',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patient.id),
    clientId: uuid('client_id').notNull(),
    role: text('role', { enum: OWNERSHIP_ROLES }).notNull(),
    /** A calendar fact: the practice's date the period starts on (docs/domain.md §10). */
    validFrom: date('valid_from').notNull(),
    /** Set once: the first day the period no longer holds (the range is half open). */
    validTo: date('valid_to'),
    note: text('note'),
    ...standardColumns(),
  },
  (table) => [
    check('ownership_role_check', sql`${table.role} in (${sqlList(OWNERSHIP_ROLES)})`),
    check('ownership_period_check', sql`${table.validTo} is null or ${table.validTo} > ${table.validFrom}`),
    index('ownership_patient_idx').on(table.patientId),
    index('ownership_client_idx').on(table.clientId),
  ],
)
