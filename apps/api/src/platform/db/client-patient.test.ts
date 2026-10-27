import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate as applyMigrations } from 'drizzle-orm/pg-core'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ruleOf } from './errors.js'
import { migrate, PRACTICE_MIGRATIONS_FOLDER } from './migrator.js'
import { MIGRATIONS_TABLE } from './table-classes.js'
import {
  asPractice,
  databaseTestsEnabled,
  dropTestPractice,
  practiceSet,
  provisionTestPractice,
  resetTestDatabase,
  type TestDatabaseUrls,
  type TestPractice,
  testDatabaseUrls,
} from './test-support.js'

/**
 * The client and patient tables (#21; spec 0002, "Data model sketch": Client, Patient), seam 1 of spec #18: what the
 * database itself guarantees about them, through the practice role as a request writes and the migrator as a
 * migration does. The API seam (src/http/registration.test.ts) proves what a person sees of the same rows.
 */

/** The last folder of the practice set before this ticket: a practice migrated up to it has no species yet. */
const BEFORE_SPECIES = '20261023120921_rules'

/** The species the seed writes (OPEN-11), with their three names from the design system glossary. */
const SPECIES = [
  { code: 'dog', name_az: 'İt', name_ru: 'Собака', name_en: 'Dog', clinically_supported: true },
  { code: 'cat', name_az: 'Pişik', name_ru: 'Кошка', name_en: 'Cat', clinically_supported: true },
  { code: 'rabbit', name_az: 'Dovşan', name_ru: 'Кролик', name_en: 'Rabbit', clinically_supported: false },
  { code: 'bird', name_az: 'Quş', name_ru: 'Птица', name_en: 'Bird', clinically_supported: false },
  { code: 'reptile', name_az: 'Sürünən', name_ru: 'Рептилия', name_en: 'Reptile', clinically_supported: false },
  { code: 'rodent', name_az: 'Gəmirici', name_ru: 'Грызун', name_en: 'Rodent', clinically_supported: false },
  { code: 'other', name_az: 'Digər', name_ru: 'Другое', name_en: 'Other', clinically_supported: false },
]

const EXCLUSION_VIOLATION = '23P01'
const CHECK_VIOLATION = '23514'
const UNIQUE_VIOLATION = '23505'

describe.skipIf(!databaseTestsEnabled())('the client and patient tables (#21, seam 1)', () => {
  let urls: TestDatabaseUrls
  let migrator: pg.Client
  /** vetora_app on vetora_test: what a request sees. */
  let app: pg.Client
  let practice: TestPractice
  let schema: string

  beforeAll(async () => {
    urls = testDatabaseUrls()
    await resetTestDatabase(urls)
    await migrate({ url: urls.migrator })
    migrator = new pg.Client({ connectionString: urls.migrator, application_name: 'client-patient.test' })
    await migrator.connect()
    app = new pg.Client({ connectionString: urls.app, application_name: 'client-patient.test app' })
    await app.connect()
    practice = await provisionTestPractice(urls)
    schema = pg.escapeIdentifier(practice.schema)
  }, 30_000)

  afterAll(async () => {
    await practice?.drop()
    await migrator?.end()
    await app?.end()
  })

  /** The seed's folder: the one migration of the set that writes species rows. */
  const seedFolder = () => practiceSet().find((name) => name.endsWith('_species_seed'))

  async function speciesOf(target: Pick<TestPractice, 'schema'>) {
    const rows = await migrator.query(
      `select code, name_az, name_ru, name_en, clinically_supported from ${pg.escapeIdentifier(target.schema)}.species
       order by sort`,
    )
    return rows.rows
  }

  async function speciesAudit(target: Pick<TestPractice, 'schema'>) {
    const rows = await migrator.query<{ action: string; actor_id: string | null; source: string }>(
      `select action, actor_id, source from ${pg.escapeIdentifier(target.schema)}.audit_event
       where table_name = 'species'`,
    )
    return rows.rows
  }

  it('seeds the seven species with their three names, dog and cat clinically supported, in a newly provisioned practice, audited as the seed migration (OPEN-11)', async () => {
    expect(seedFolder()).toBeDefined()
    expect(await speciesOf(practice)).toEqual(SPECIES)
    const audit = await speciesAudit(practice)
    expect(audit).toHaveLength(SPECIES.length)
    for (const row of audit) {
      expect(row).toEqual({ action: 'insert', actor_id: null, source: `migration:${seedFolder()}` })
    }
  })

  /**
   * A practice whose schema stands where the practice set stood before this ticket, as an older image left it: its
   * registry row and role by hand, then the earlier migrations applied straight to its schema. The grants pass is left
   * to the migrate run that follows, since today's class registry names tables the earlier set lacks.
   */
  async function registerBeforeSpecies(): Promise<Pick<TestPractice, 'practiceId' | 'slug' | 'schema' | 'role'>> {
    const before = mkdtempSync(join(tmpdir(), 'vetora-before-species-'))
    try {
      for (const name of practiceSet().filter((folder) => folder <= BEFORE_SPECIES)) {
        cpSync(join(PRACTICE_MIGRATIONS_FOLDER, name), join(before, name), { recursive: true })
      }
      const id = (await migrator.query<{ id: string }>('select uuidv7()::text as id')).rows[0]?.id as string
      const older = { practiceId: id, slug: `b-${id.slice(-8)}`, schema: `p_${id}`, role: `p_${id}_role` }
      await migrator.query(
        `insert into control.practice (id, slug, name, schema_name, role_name, status) values ($1, $2, 'Older', $3, $4, 'active')`,
        [id, older.slug, older.schema, older.role],
      )
      await migrator.query(`create role ${pg.escapeIdentifier(older.role)} nologin`)
      await migrator.query(`create schema ${pg.escapeIdentifier(older.schema)} authorization vetora_migrator`)
      await drizzle({ client: migrator }).transaction(async (tx) => {
        await migrator.query(`set local search_path to ${pg.escapeIdentifier(older.schema)}, ext`)
        await applyMigrations(readMigrationFiles({ migrationsFolder: before }), tx, {
          migrationsFolder: before,
          migrationsSchema: older.schema,
          migrationsTable: MIGRATIONS_TABLE,
        })
      })
      return older
    } finally {
      rmSync(before, { recursive: true, force: true })
    }
  }

  it('seeds the same species in a practice migrated from before the seed, audited the same way', async () => {
    const older = await registerBeforeSpecies()
    try {
      const tables = await migrator.query('select to_regclass($1) as found', [`${older.schema}.species`])
      expect(tables.rows[0]?.found).toBeNull()

      const outcome = await migrate({ url: urls.migrator, practice: older.slug })

      expect(outcome).toMatchObject({
        status: 'applied',
        practices: [{ slug: older.slug, applied: practiceSet().filter((folder) => folder > BEFORE_SPECIES) }],
      })
      expect(await speciesOf(older)).toEqual(SPECIES)
      const audit = await speciesAudit(older)
      expect(audit).toHaveLength(SPECIES.length)
      for (const row of audit) expect(row.source).toBe(`migration:${seedFolder()}`)
    } finally {
      await dropTestPractice(urls, older)
    }
  }, 30_000)

  /** One row in each of the six tables, inserted through the practice role as `actor` would write it; their ids. */
  async function registerOne(actor?: string | null) {
    return asPractice(
      app,
      practice,
      async (client) => {
        const species = await client.query<{ id: string }>(
          `insert into ${schema}.species (code, name_az, name_ru, name_en, clinically_supported, sort)
           values ('ferret-' || substr(md5(random()::text), 1, 6), 'Ferret', 'Хорёк', 'Ferret', false, 99) returning id`,
        )
        const speciesId = species.rows[0]?.id
        const dog = await client.query<{ id: string }>(`select id from ${schema}.species where code = 'dog'`)
        const breed = await client.query<{ id: string }>(
          `insert into ${schema}.breed (species_id, name_ru) values ($1, 'Лабрадор ' || substr(md5(random()::text), 1, 6))
           returning id`,
          [dog.rows[0]?.id],
        )
        const clientRow = await client.query<{ id: string }>(
          `insert into ${schema}.client (first_name, last_name, preferred_language) values ('Aysel', 'Məmmədova', 'az')
           returning id`,
        )
        const clientId = clientRow.rows[0]?.id
        const contact = await client.query<{ id: string }>(
          `insert into ${schema}.client_contact (client_id, kind, value, value_normalised, is_primary)
           values ($1, 'phone', '050 123 45 67', '+994501234567', true) returning id`,
          [clientId],
        )
        const patient = await client.query<{ id: string }>(
          `insert into ${schema}.patient (name, species_id, breed_id, sex) values ('Şəkər', $1, $2, 'female') returning id`,
          [dog.rows[0]?.id, breed.rows[0]?.id],
        )
        const ownership = await client.query<{ id: string }>(
          `insert into ${schema}.ownership (patient_id, client_id, role, valid_from) values ($1, $2, 'owner', current_date)
           returning id`,
          [patient.rows[0]?.id, clientId],
        )
        return {
          species: speciesId,
          breed: breed.rows[0]?.id,
          client: clientId,
          client_contact: contact.rows[0]?.id,
          patient: patient.rows[0]?.id,
          ownership: ownership.rows[0]?.id,
        }
      },
      actor === undefined ? undefined : { actor },
    )
  }

  it('IN-1: every insert on client, client_contact, species, breed, patient and ownership writes one audit_event row naming the actor', async () => {
    const ids = await registerOne()

    for (const [table, id] of Object.entries(ids)) {
      const rows = await migrator.query(
        `select action, actor_id, source, changed ->> 'created_by' as created_by from ${schema}.audit_event
         where table_name = $1 and row_id = $2`,
        [table, id],
      )
      expect(rows.rows, table).toEqual([
        { action: 'insert', actor_id: practice.managerId, source: 'request', created_by: practice.managerId },
      ])
    }
  })

  it('IN-1: a write without an actor is refused with vetora.no_actor, and nothing of it is kept', async () => {
    const before = await migrator.query<{ n: number }>(`select count(*)::int as n from ${schema}.client`)
    for (const actor of [null, '']) {
      const refused = await registerOne(actor).catch((error: unknown) => error)
      expect(ruleOf(refused), String(actor)).toBe('vetora.no_actor')
    }
    const after = await migrator.query<{ n: number }>(`select count(*)::int as n from ${schema}.client`)
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n)
  })

  it('AC-5: a second owner row overlapping the first for one patient is refused; closing the first with valid_to and opening another keeps both (PT-1)', async () => {
    const { patient, client: first } = await registerOne()
    const second = await asPractice(app, practice, async (client) => {
      const row = await client.query<{ id: string }>(
        `insert into ${schema}.client (first_name, last_name, preferred_language) values ('Rəşad', 'Əliyev', 'ru')
         returning id`,
      )
      return row.rows[0]?.id
    })
    const own = (clientId: string | undefined, from: string, to: string | null = null) =>
      asPractice(app, practice, (client) =>
        client.query(
          `insert into ${schema}.ownership (patient_id, client_id, role, valid_from, valid_to)
           values ($1, $2, 'owner', $3, $4)`,
          [patient, clientId, from, to],
        ),
      )

    // The first owner holds from today, open ended: another owner from tomorrow overlaps it.
    const overlap = await own(second, 'tomorrow').catch((error: { code?: string }) => error)
    expect(overlap).toMatchObject({ code: EXCLUSION_VIOLATION, constraint: 'ownership_one_owner' })
    // An authorised person is not an owner and may overlap.
    await asPractice(app, practice, (client) =>
      client.query(
        `insert into ${schema}.ownership (patient_id, client_id, role, valid_from)
         values ($1, $2, 'authorised_person', current_date)`,
        [patient, second],
      ),
    )

    // Closing the first from tomorrow (set once) and opening the second from tomorrow keeps both.
    await asPractice(app, practice, (client) =>
      client.query(
        `update ${schema}.ownership set valid_to = current_date + 1 where patient_id = $1 and client_id = $2`,
        [patient, first],
      ),
    )
    await own(second, 'tomorrow')

    const owners = await migrator.query<{ client_id: string; open: boolean }>(
      `select client_id, valid_to is null as open from ${schema}.ownership
       where patient_id = $1 and role = 'owner' order by valid_from`,
      [patient],
    )
    expect(owners.rows).toEqual([
      { client_id: first, open: false },
      { client_id: second, open: true },
    ])
    // valid_to is set once, and never on or before valid_from.
    const reclosed = await asPractice(app, practice, (client) =>
      client.query(
        `update ${schema}.ownership set valid_to = current_date + 5 where patient_id = $1 and client_id = $2`,
        [patient, first],
      ),
    ).catch((error: unknown) => error)
    expect(ruleOf(reclosed)).toBe('vetora.set_once')
    const backwards = await own(second, 'tomorrow', 'today').catch((error: { code?: string }) => error)
    expect(backwards).toMatchObject({ code: CHECK_VIOLATION, constraint: 'ownership_period_check' })
  })

  it("holds the sketch's keys: a person has a last name, one primary contact per client, a breed has a name and one Russian name per species, a microchip belongs to one patient", async () => {
    const refusal = (sql: string, params: unknown[] = []) =>
      asPractice(app, practice, (client) => client.query(sql, params)).catch((error: { code?: string }) => error)
    const { client: clientId, patient } = await registerOne()
    const dog = (await migrator.query<{ id: string }>(`select id from ${schema}.species where code = 'dog'`)).rows[0]
      ?.id

    expect(
      await refusal(`insert into ${schema}.client (first_name, preferred_language) values ('Aysel', 'az')`),
    ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'client_name_check' })
    expect(
      await refusal(
        `insert into ${schema}.client_contact (client_id, kind, value, value_normalised, is_primary)
         values ($1, 'phone', '055 987 65 43', '+994559876543', true)`,
        [clientId],
      ),
    ).toMatchObject({ code: UNIQUE_VIOLATION, constraint: 'client_contact_primary_idx' })
    expect(await refusal(`insert into ${schema}.breed (species_id) values ($1)`, [dog])).toMatchObject({
      code: CHECK_VIOLATION,
      constraint: 'breed_name_check',
    })
    await asPractice(app, practice, (client) =>
      client.query(`insert into ${schema}.breed (species_id, name_ru) values ($1, 'Такса')`, [dog]),
    )
    expect(
      await refusal(`insert into ${schema}.breed (species_id, name_ru) values ($1, 'Такса')`, [dog]),
    ).toMatchObject({ code: UNIQUE_VIOLATION, constraint: 'breed_species_name_ru_idx' })
    await asPractice(app, practice, (client) =>
      client.query(`update ${schema}.patient set microchip_number = '643094100123456' where id = $1`, [patient]),
    )
    expect(
      await refusal(
        `insert into ${schema}.patient (name, species_id, sex, microchip_number) values ('Bəbir', $1, 'male', '643094100123456')`,
        [dog],
      ),
    ).toMatchObject({ code: UNIQUE_VIOLATION, constraint: 'patient_microchip_number_idx' })
  })
})
