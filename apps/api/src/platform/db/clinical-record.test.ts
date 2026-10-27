import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ruleOf } from './errors.js'
import { migrate } from './migrator.js'
import {
  asPractice,
  databaseTestsEnabled,
  PERMISSION_DENIED,
  provisionTestPractice,
  resetTestDatabase,
  type TestDatabaseUrls,
  type TestPractice,
  testDatabaseUrls,
} from './test-support.js'

/**
 * The visit and its care relationship (#22; spec 0002, "Data model sketch": Clinical Record, "State transitions",
 * AC-2, AC-14), seam 1 of spec #18: what the database itself guarantees, through the practice role as a request writes,
 * whatever the API does. The API seam (src/http/visits.test.ts) proves the handler's side: the relationship it creates
 * or extends, and what a person sees.
 */

const CHECK_VIOLATION = '23514'
const UNIQUE_VIOLATION = '23505'

describe.skipIf(!databaseTestsEnabled())('the care relationship and the visit (#22, seam 1)', () => {
  let urls: TestDatabaseUrls
  let migrator: pg.Client
  /** vetora_app on vetora_test: what a request sees. */
  let app: pg.Client
  let practice: TestPractice
  let schema: string
  /** Two veterinarians and an assistant, besides the manager who provisioned the practice. */
  const staff = { vet: '', otherVet: '', assistant: '' }
  let locationId: string

  beforeAll(async () => {
    urls = testDatabaseUrls()
    await resetTestDatabase(urls)
    await migrate({ url: urls.migrator })
    migrator = new pg.Client({ connectionString: urls.migrator, application_name: 'clinical-record.test' })
    await migrator.connect()
    app = new pg.Client({ connectionString: urls.app, application_name: 'clinical-record.test app' })
    await app.connect()
    practice = await provisionTestPractice(urls)
    schema = pg.escapeIdentifier(practice.schema)
    await asPractice(app, practice, async (client) => {
      for (const [key, roles] of [
        ['vet', '{veterinarian}'],
        ['otherVet', '{veterinarian}'],
        ['assistant', '{assistant}'],
      ] as const) {
        const row = await client.query<{ id: string }>(
          `insert into ${schema}.staff_member (id, display_name, roles, synced_at)
           values (uuidv7(), $1, $2, now()) returning id`,
          [key, roles],
        )
        staff[key] = row.rows[0]?.id as string
      }
      const here = await client.query<{ id: string }>(`select id from ${schema}.location where is_default`)
      locationId = here.rows[0]?.id as string
    })
  }, 30_000)

  afterAll(async () => {
    await practice?.drop()
    await migrator?.end()
    await app?.end()
  })

  /** A client who owns a new patient from today; their ids. */
  async function ownedPatient() {
    return asPractice(app, practice, async (client) => {
      const owner = await client.query<{ id: string }>(
        `insert into ${schema}.client (first_name, last_name, preferred_language) values ('Aysel', 'Məmmədova', 'az')
         returning id`,
      )
      const dog = await client.query<{ id: string }>(`select id from ${schema}.species where code = 'dog'`)
      const patient = await client.query<{ id: string }>(
        `insert into ${schema}.patient (name, species_id, sex) values ('Şəkər', $1, 'female') returning id`,
        [dog.rows[0]?.id],
      )
      await client.query(
        `insert into ${schema}.ownership (patient_id, client_id, role, valid_from) values ($1, $2, 'owner', current_date)`,
        [patient.rows[0]?.id, owner.rows[0]?.id],
      )
      return { clientId: owner.rows[0]?.id as string, patientId: patient.rows[0]?.id as string }
    })
  }

  /** A draft visit started by `vet` at the default location, its client and reporter the owner, its reason given. */
  async function draftVisit(vet = staff.vet, reason: string | null = 'Not eating since yesterday') {
    const { clientId, patientId } = await ownedPatient()
    const visit = await asPractice(
      app,
      practice,
      (client) =>
        client.query<{ id: string }>(
          `insert into ${schema}.encounter
             (location_id, patient_id, client_id, veterinarian_id, reported_by_client_id, reason_for_visit)
           values ($1, $2, $3, $4, $3, $5) returning id`,
          [locationId, patientId, clientId, vet, reason],
        ),
      { actor: vet },
    )
    return { visitId: visit.rows[0]?.id as string, patientId, clientId }
  }

  /** A care relationship of the patient with `vet`, established a month ago and lapsing at `lapses` (SQL). */
  async function relationship(patientId: string, vet: string, lapses = "now() + interval '12 months'") {
    const row = await asPractice(
      app,
      practice,
      (client) =>
        client.query<{ id: string }>(
          `insert into ${schema}.care_relationship (patient_id, veterinarian_id, established_at, lapses_at)
           values ($1, $2, now() - interval '1 month', ${lapses}) returning id`,
          [patientId, vet],
        ),
      { actor: vet },
    )
    return row.rows[0]?.id as string
  }

  /** The finalising update a request runs, as `actor`, naming `finaliser` and the relationship. */
  const finalise = (visitId: string, actor: string, relationshipId: string | null, finaliser = actor) =>
    asPractice(
      app,
      practice,
      (client) =>
        client.query(
          `update ${schema}.encounter
           set status = 'finalised', finalised_at = now(), finalised_by = $2, ended_at = now(), care_relationship_id = $3
           where id = $1`,
          [visitId, finaliser, relationshipId],
        ),
      { actor },
    )

  const refusalOf = (work: Promise<unknown>) =>
    work.then(
      () => undefined,
      (error: unknown) => error,
    )

  const statusOf = async (visitId: string) =>
    (await migrator.query<{ status: string }>(`select status from ${schema}.encounter where id = $1`, [visitId]))
      .rows[0]?.status

  it('IN-1: an insert on care_relationship and encounter writes one audit_event row naming the actor', async () => {
    const { visitId, patientId } = await draftVisit()
    const relationshipId = await relationship(patientId, staff.vet)

    for (const [table, id] of [
      ['encounter', visitId],
      ['care_relationship', relationshipId],
    ] as const) {
      const rows = await migrator.query(
        `select action, actor_id, source from ${schema}.audit_event where table_name = $1 and row_id = $2`,
        [table, id],
      )
      expect(rows.rows, table).toEqual([{ action: 'insert', actor_id: staff.vet, source: 'request' }])
    }
  })

  it('completes a draft visit for the vet who holds the current care relationship, with a reason and its reporter', async () => {
    const { visitId, patientId } = await draftVisit()
    const relationshipId = await relationship(patientId, staff.vet)

    await finalise(visitId, staff.vet, relationshipId)

    expect(await statusOf(visitId)).toBe('finalised')
  })

  it('CR-2: completion by a non veterinarian is refused even past the API, naming the assistant or a vet', async () => {
    const { visitId, patientId } = await draftVisit()
    const relationshipId = await relationship(patientId, staff.vet)

    for (const finaliser of [staff.assistant, staff.vet]) {
      const refused = await refusalOf(finalise(visitId, staff.assistant, relationshipId, finaliser))
      expect(ruleOf(refused), finaliser).toBe('vetora.not_veterinarian')
    }
    // A vet naming another vet as the finaliser is refused the same way.
    expect(ruleOf(await refusalOf(finalise(visitId, staff.vet, relationshipId, staff.otherVet)))).toBe(
      'vetora.not_veterinarian',
    )
    expect(await statusOf(visitId)).toBe('draft')
  })

  it('completion with a blank reason for visit is refused (spec 0002, encounter: finalising requires it)', async () => {
    for (const reason of [null, '', '  \n ']) {
      const { visitId, patientId } = await draftVisit(staff.vet, reason)
      const relationshipId = await relationship(patientId, staff.vet)
      const refused = await refusalOf(finalise(visitId, staff.vet, relationshipId))
      expect(ruleOf(refused), JSON.stringify(reason)).toBe('vetora.reason_for_visit_required')
    }
  })

  it('AC-14, CR-4: completion without a current care relationship is refused: none, lapsed, ended, or another patient', async () => {
    const { visitId, patientId } = await draftVisit()
    const lapsed = await relationship(patientId, staff.vet, "now() - interval '1 day'")
    const other = await ownedPatient()
    const elsewhere = await relationship(other.patientId, staff.vet)

    for (const [label, relationshipId] of [
      ['none', null],
      ['lapsed', lapsed],
      ['another patient', elsewhere],
    ] as const) {
      const refused = await refusalOf(finalise(visitId, staff.vet, relationshipId))
      expect(ruleOf(refused), label).toBe('vetora.no_care_relationship')
    }

    const second = await draftVisit()
    const ended = await relationship(second.patientId, staff.vet)
    await asPractice(
      app,
      practice,
      (client) =>
        client.query(`update ${schema}.care_relationship set ended_at = now(), ended_by = $2 where id = $1`, [
          ended,
          staff.vet,
        ]),
      { actor: staff.vet },
    )
    expect(ruleOf(await refusalOf(finalise(second.visitId, staff.vet, ended)))).toBe('vetora.no_care_relationship')
    expect(await statusOf(visitId)).toBe('draft')
  })

  it("AC-14: another vet's current relationship counts while delegation is on, and not once it is off", async () => {
    const setDelegation = (on: boolean) =>
      asPractice(app, practice, (client) =>
        client.query(`update ${schema}.practice_settings set delegation_enabled = $1`, [on]),
      )
    const { visitId, patientId } = await draftVisit()
    const theirs = await relationship(patientId, staff.otherVet)

    await setDelegation(false)
    try {
      expect(ruleOf(await refusalOf(finalise(visitId, staff.vet, theirs)))).toBe('vetora.no_care_relationship')
    } finally {
      await setDelegation(true)
    }
    await finalise(visitId, staff.vet, theirs)
    expect(await statusOf(visitId)).toBe('finalised')
  })

  it('AC-2, CR-1: once completed, an update to the visit, a second completion and a cancel all fail with vetora.frozen_record', async () => {
    const { visitId, patientId } = await draftVisit()
    const relationshipId = await relationship(patientId, staff.vet)
    await finalise(visitId, staff.vet, relationshipId)

    const asVet = (sql: string) =>
      refusalOf(asPractice(app, practice, (client) => client.query(sql, [visitId]), { actor: staff.vet }))
    expect(ruleOf(await asVet(`update ${schema}.encounter set treatment = 'Fluids' where id = $1`))).toBe(
      'vetora.frozen_record',
    )
    expect(ruleOf(await finalise(visitId, staff.vet, relationshipId).catch((error: unknown) => error))).toBe(
      'vetora.frozen_record',
    )
    expect(ruleOf(await asVet(`update ${schema}.encounter set status = 'discarded' where id = $1`))).toBe(
      'vetora.frozen_record',
    )
    expect(await statusOf(visitId)).toBe('finalised')
  })

  it('a cancelled draft is final too: it can be neither edited nor completed', async () => {
    const { visitId, patientId } = await draftVisit()
    const relationshipId = await relationship(patientId, staff.vet)
    await asPractice(
      app,
      practice,
      (client) => client.query(`update ${schema}.encounter set status = 'discarded' where id = $1`, [visitId]),
      { actor: staff.vet },
    )

    expect(ruleOf(await refusalOf(finalise(visitId, staff.vet, relationshipId)))).toBe('vetora.frozen_record')
    expect(await statusOf(visitId)).toBe('discarded')
  })

  it('CR-5: a reason or a history without who told it is refused', async () => {
    const { visitId } = await draftVisit(staff.vet, null)
    for (const column of ['reason_for_visit', 'anamnesis']) {
      const refused = await refusalOf(
        asPractice(
          app,
          practice,
          (client) =>
            client.query(
              `update ${schema}.encounter set reported_by_client_id = null, ${column} = 'Limping' where id = $1`,
              [visitId],
            ),
          { actor: staff.assistant },
        ),
      )
      expect(refused, column).toMatchObject({ code: CHECK_VIOLATION, constraint: 'encounter_reporter_check' })
    }
  })

  it('a care relationship lapses only later, ends once, and is open once per patient and vet', async () => {
    const { patientId } = await ownedPatient()
    const relationshipId = await relationship(patientId, staff.vet)
    const asVet = (sql: string, params: unknown[] = [relationshipId]) =>
      refusalOf(asPractice(app, practice, (client) => client.query(sql, params), { actor: staff.vet }))

    expect(
      await asVet(`update ${schema}.care_relationship set lapses_at = lapses_at + interval '1 day' where id = $1`),
    ).toBe(undefined)
    expect(
      ruleOf(
        await asVet(`update ${schema}.care_relationship set lapses_at = lapses_at - interval '1 day' where id = $1`),
      ),
    ).toBe('vetora.set_once')
    expect(ruleOf(await asVet(`update ${schema}.care_relationship set lapses_at = null where id = $1`))).toBe(
      'vetora.set_once',
    )
    // Any other column is not even granted (the set once class, table-classes.ts).
    expect(await asVet(`update ${schema}.care_relationship set established_at = now() where id = $1`)).toMatchObject(
      PERMISSION_DENIED,
    )
    expect(
      await asVet(
        `insert into ${schema}.care_relationship (patient_id, veterinarian_id, established_at, lapses_at)
                   values ($1, $2, now(), now() + interval '1 year')`,
        [patientId, staff.vet],
      ),
    ).toMatchObject({ code: UNIQUE_VIOLATION, constraint: 'care_relationship_open_idx' })

    await asVet(`update ${schema}.care_relationship set ended_at = now(), ended_by = $2 where id = $1`, [
      relationshipId,
      staff.vet,
    ])
    expect(
      ruleOf(await asVet(`update ${schema}.care_relationship set ended_at = now() + interval '1 hour' where id = $1`)),
    ).toBe('vetora.set_once')
    // Once ended, the pair may open a new one.
    expect(
      await asVet(
        `insert into ${schema}.care_relationship (patient_id, veterinarian_id, established_at, lapses_at)
                   values ($1, $2, now(), now() + interval '1 year')`,
        [patientId, staff.vet],
      ),
    ).toBe(undefined)
  })
})
