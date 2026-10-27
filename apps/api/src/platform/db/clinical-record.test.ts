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
 * AC-2, AC-14) and its vital signs (#23; AC-6's first half), seam 1 of spec #18: what the database itself guarantees,
 * through the practice role as a request writes, whatever the API does. The API seam (src/http/visits.test.ts,
 * src/http/observations.test.ts) proves the handler's side: the relationship it creates or extends, the readings it
 * times and attributes, and what a person sees.
 */

const CHECK_VIOLATION = '23514'
const NOT_NULL_VIOLATION = '23502'
const FOREIGN_KEY_VIOLATION = '23503'
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

  describe('the vital signs: clinical_observation (#23; spec 0002, "Data model sketch": clinical_observation)', () => {
    type Reading = {
      kind?: string
      value?: string
      unit?: string | null
      occurredAt?: string
      measuredBy?: string | null
    }

    /** A reading on the visit as a request writes it, as `actor`, measured by them unless the case says otherwise. */
    const record = (visitId: string, patientId: string, actor: string, reading: Reading = {}) =>
      asPractice(
        app,
        practice,
        (client) =>
          client.query<{ id: string }>(
            `insert into ${schema}.clinical_observation
               (location_id, patient_id, encounter_id, kind, value, unit, occurred_at, measured_by)
             values ($1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, now()), $8) returning id`,
            [
              locationId,
              patientId,
              visitId,
              reading.kind ?? 'weight',
              reading.value ?? '4.2',
              reading.unit === undefined ? 'kg' : reading.unit,
              reading.occurredAt ?? null,
              reading.measuredBy === undefined ? actor : reading.measuredBy,
            ],
          ),
        { actor },
      ).then((result) => result.rows[0]?.id as string)

    const readings = async (visitId: string) =>
      (
        await migrator.query<Record<string, unknown>>(
          `select kind, value::text as value, unit, measured_by, occurred_at <= now() as timed
           from ${schema}.clinical_observation where encounter_id = $1 order by occurred_at, id`,
          [visitId],
        )
      ).rows

    it('stores each of the four kinds with value, unit, time and measurer, and IN-1 writes an audit row naming the actor', async () => {
      const { visitId, patientId } = await draftVisit()

      const ids = [
        await record(visitId, patientId, staff.assistant, { kind: 'weight', value: '4.2', unit: 'kg' }),
        await record(visitId, patientId, staff.assistant, { kind: 'temperature', value: '38.5', unit: '°C' }),
        await record(visitId, patientId, staff.vet, { kind: 'pulse', value: '96', unit: '/min' }),
        await record(visitId, patientId, staff.vet, { kind: 'respiratory_rate', value: '24', unit: '/min' }),
      ]

      expect(await readings(visitId)).toEqual([
        { kind: 'weight', value: '4.200', unit: 'kg', measured_by: staff.assistant, timed: true },
        { kind: 'temperature', value: '38.500', unit: '°C', measured_by: staff.assistant, timed: true },
        { kind: 'pulse', value: '96.000', unit: '/min', measured_by: staff.vet, timed: true },
        { kind: 'respiratory_rate', value: '24.000', unit: '/min', measured_by: staff.vet, timed: true },
      ])
      const audit = await migrator.query(
        `select row_id, actor_id from ${schema}.audit_event
         where table_name = 'clinical_observation' and action = 'insert' and row_id = any($1::uuid[]) order by row_id`,
        [ids],
      )
      expect(audit.rows).toEqual(
        [
          { row_id: ids[0], actor_id: staff.assistant },
          { row_id: ids[1], actor_id: staff.assistant },
          { row_id: ids[2], actor_id: staff.vet },
          { row_id: ids[3], actor_id: staff.vet },
        ].sort((a, b) => (a.row_id as string).localeCompare(b.row_id as string)),
      )
    })

    it('CR-3: a reading without a unit or a measurer is refused, and each kind keeps its unit (weight in kg)', async () => {
      const { visitId, patientId } = await draftVisit()
      const refused = (reading: Reading) => refusalOf(record(visitId, patientId, staff.vet, reading))

      expect(await refused({ unit: null })).toMatchObject({ code: NOT_NULL_VIOLATION, column: 'unit' })
      expect(await refused({ measuredBy: null })).toMatchObject({ code: NOT_NULL_VIOLATION, column: 'measured_by' })
      for (const reading of [
        { kind: 'weight', unit: 'g' },
        { kind: 'weight', unit: '' },
        { kind: 'temperature', value: '38.5', unit: '°F' },
        { kind: 'pulse', value: '96', unit: 'bpm' },
        { kind: 'respiratory_rate', value: '24', unit: '/h' },
        { kind: 'other', value: '1', unit: ' ' },
      ]) {
        expect(await refused(reading), JSON.stringify(reading)).toMatchObject({
          code: CHECK_VIOLATION,
          constraint: 'clinical_observation_unit_check',
        })
      }
      expect(await refused({ kind: 'mood', unit: 'kg' })).toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'clinical_observation_kind_check',
      })
      expect(await readings(visitId)).toEqual([])
    })

    it('IN-1: a reading without an actor is refused with vetora.no_actor, and nothing of it is kept', async () => {
      const { visitId, patientId } = await draftVisit()

      for (const actor of [null, '']) {
        const refused = await refusalOf(
          asPractice(
            app,
            practice,
            (client) =>
              client.query(
                `insert into ${schema}.clinical_observation
                   (location_id, patient_id, encounter_id, kind, value, unit, measured_by)
                 values ($1, $2, $3, 'weight', 4.2, 'kg', $4)`,
                [locationId, patientId, visitId, staff.vet],
              ),
            { actor },
          ),
        )
        expect(ruleOf(refused), String(actor)).toBe('vetora.no_actor')
      }
      expect(await readings(visitId)).toEqual([])
    })

    it("a reading names its visit's patient: another patient with that visit is refused by the key on the pair", async () => {
      const { visitId } = await draftVisit()
      const other = await ownedPatient()

      expect(await refusalOf(record(visitId, other.patientId, staff.vet))).toMatchObject({
        code: FOREIGN_KEY_VIOLATION,
        constraint: 'clinical_observation_encounter_patient_fkey',
      })
    })

    it('AC-13: occurred_at is never in the future and back datable within the practice limit', async () => {
      const { visitId, patientId } = await draftVisit()

      expect(
        await refusalOf(
          record(visitId, patientId, staff.vet, { occurredAt: new Date(Date.now() + 3_600_000).toISOString() }),
        ),
      ).toMatchObject({ code: CHECK_VIOLATION, constraint: 'clinical_observation_occurred_at_check' })
      const twoDaysAgo = new Date(Date.now() - 48 * 3_600_000).toISOString()
      expect(ruleOf(await refusalOf(record(visitId, patientId, staff.vet, { occurredAt: twoDaysAgo })))).toBe(
        'vetora.backdated_too_far',
      )
      // An hour ago is within the default 24 hours: weighed before the vet sat down to write.
      const anHourAgo = new Date(Date.now() - 3_600_000).toISOString()
      expect(await refusalOf(record(visitId, patientId, staff.vet, { occurredAt: anHourAgo }))).toBe(undefined)
    })

    it('PT-2, AC-6 first half: a reading cannot change or go through the practice role; a corrected weight is a second row and both remain', async () => {
      const { visitId, patientId } = await draftVisit()
      const first = await record(visitId, patientId, staff.assistant, { value: '4.2' })
      const asAssistant = (sql: string) =>
        refusalOf(asPractice(app, practice, (client) => client.query(sql, [first]), { actor: staff.assistant }))

      expect(await asAssistant(`update ${schema}.clinical_observation set value = 4.3 where id = $1`)).toMatchObject(
        PERMISSION_DENIED,
      )
      expect(await asAssistant(`delete from ${schema}.clinical_observation where id = $1`)).toMatchObject(
        PERMISSION_DENIED,
      )
      await record(visitId, patientId, staff.assistant, { value: '4.3' })

      expect((await readings(visitId)).map((reading) => reading.value)).toEqual(['4.200', '4.300'])
    })

    it('AC-2: a reading on a completed or a cancelled visit is refused with vetora.frozen_record, and the earlier ones stay', async () => {
      const completed = await draftVisit()
      await record(completed.visitId, completed.patientId, staff.assistant)
      await finalise(completed.visitId, staff.vet, await relationship(completed.patientId, staff.vet))

      expect(
        ruleOf(await refusalOf(record(completed.visitId, completed.patientId, staff.assistant, { value: '4.4' }))),
      ).toBe('vetora.frozen_record')
      expect((await readings(completed.visitId)).map((reading) => reading.value)).toEqual(['4.200'])

      const cancelled = await draftVisit()
      await asPractice(
        app,
        practice,
        (client) =>
          client.query(`update ${schema}.encounter set status = 'discarded' where id = $1`, [cancelled.visitId]),
        { actor: staff.vet },
      )
      expect(ruleOf(await refusalOf(record(cancelled.visitId, cancelled.patientId, staff.vet)))).toBe(
        'vetora.frozen_record',
      )
    })
  })
})
