import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from '../platform/db/migrator.js'
import {
  connectTestClient,
  databaseTestsEnabled,
  escapeIdentifier as ident,
  resetTestDatabase,
  type TestClient,
  type TestDatabaseUrls,
  testDatabaseUrls,
} from '../platform/db/test-support.js'
import { uuidv7 } from '../platform/ids.js'
import { type ApiPractice, type Login, provisionApiPractice } from '../test-support.js'

/**
 * Starting a visit, writing its note, completing or cancelling it, and Visits today, through the API (#22; spec #18,
 * stories 28, 36, 38, 43 to 46, 50 to 55, 73), seam 2: the real app, a provisioned practice, a vet's, an assistant's
 * and a receptionist's sessions. What the database refuses whatever the API does is clinical-record.test.ts.
 */
describe.skipIf(!databaseTestsEnabled())('the visit and its note (#22, seam 2)', () => {
  let urls: TestDatabaseUrls
  let migrator: TestClient
  let practice: ApiPractice
  let vet: Login
  let colleague: Login
  let assistant: Login
  let desk: Login
  let dog: string

  beforeAll(async () => {
    urls = testDatabaseUrls()
    await resetTestDatabase(urls)
    await migrate({ url: urls.migrator })
    migrator = await connectTestClient(urls.migrator, 'visits.test')
    // A migrator session that writes practice rows by hand names its source once (docs/database.md, "Actor and audit").
    await migrator.query("select set_config('app.migration', 'visits.test', false)")
    practice = await provisionApiPractice(urls, { name: 'Alfa Vet', timeZone: 'Asia/Baku' })
    vet = await practice.addStaff('leyla', ['veterinarian'], { name: 'Leyla Həsənova' })
    colleague = await practice.addStaff('rauf', ['veterinarian'], { name: 'Rauf Kərimov' })
    assistant = await practice.addStaff('tural', ['assistant'], { name: 'Tural Quliyev' })
    desk = await practice.addStaff('aysel', ['receptionist'], { name: 'Aysel Quliyeva' })
    const species = (await (await practice.request(desk, '/species')).json()) as {
      species: { id: string; code: string }[]
    }
    dog = species.species.find((item) => item.code === 'dog')?.id as string
  }, 60_000)

  afterAll(async () => {
    await practice?.drop()
    await migrator?.end()
  })

  const schema = () => ident(practice.schema)

  /** A new client with their phone and a new dog, as New visit sends them. */
  const registration = () => ({
    client: {
      type: 'new',
      id: uuidv7(),
      firstName: 'Aysel',
      lastName: 'Məmmədova',
      patronymic: 'Rəşad qızı',
      phone: '+994 50 123 45 67',
      preferredLanguage: 'az',
    },
    patient: {
      type: 'new',
      id: uuidv7(),
      name: 'Şəkər',
      speciesId: dog,
      sex: 'female',
      birthDate: '2022-03-01',
      birthDateIsEstimate: false,
      isNeutered: true,
    },
  })

  const start = (visitId: string, body: unknown, login = vet, location?: string) =>
    practice.request(login, `/visits/${visitId}`, { method: 'PUT', body, location })

  /** A visit started by the vet for a new client and pet; its ids. */
  async function started(location?: string) {
    const body = registration()
    const visitId = uuidv7()
    const response = await start(visitId, body, vet, location)
    expect(response.status).toBe(200)
    return { visitId, clientId: body.client.id, patientId: body.patient.id }
  }

  const note = (overrides: Record<string, string> = {}) => ({
    reasonForVisit: 'Not eating since yesterday',
    anamnesis: 'Indoor dog, vaccinated in March',
    examination: 'Quiet, mildly dehydrated',
    diagnosis: 'Suspected gastritis',
    treatment: 'Fluids 100 ml s.c.',
    recommendations: 'Light food for three days',
    ...overrides,
  })

  const saveNote = (visitId: string, version: number, body: unknown, login = vet) =>
    practice.request(login, `/visits/${visitId}/note`, {
      method: 'PUT',
      body,
      headers: { 'if-match': `"${version}"` },
    })
  const complete = (visitId: string, version: number, login = vet) =>
    practice.request(login, `/visits/${visitId}/complete`, { method: 'POST', headers: { 'if-match': `"${version}"` } })
  const cancel = (visitId: string, version: number, login = vet) =>
    practice.request(login, `/visits/${visitId}/cancel`, { method: 'POST', headers: { 'if-match': `"${version}"` } })
  const read = (visitId: string, login = vet) => practice.request(login, `/visits/${visitId}`)

  const visitRow = async (visitId: string) =>
    (
      await migrator.query<Record<string, unknown>>(
        `select status, version, location_id, patient_id, client_id, reported_by_client_id, veterinarian_id,
                reason_for_visit, finalised_by, care_relationship_id, started_at <= now() as started_before_now
         from ${schema()}.encounter where id = $1`,
        [visitId],
      )
    ).rows[0]

  /** The rows a retry must leave as they were, the audit log included. */
  async function counts() {
    const rows = await migrator.query<Record<string, number>>(
      `select (select count(*)::int from ${schema()}.client) as client,
              (select count(*)::int from ${schema()}.patient) as patient,
              (select count(*)::int from ${schema()}.encounter) as encounter,
              (select count(*)::int from ${schema()}.care_relationship) as care_relationship,
              (select count(*)::int from ${schema()}.audit_event) as audit_event`,
    )
    return rows.rows[0]
  }

  it("Start visit by a vet creates the draft visit with the patient's owner as its client and reporter, at the request's location, the vet as its veterinarian; the same request again changes nothing", async () => {
    const body = registration()
    const visitId = uuidv7()

    const response = await start(visitId, body)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ clientId: body.client.id, patientId: body.patient.id, visitId })
    expect(await visitRow(visitId)).toEqual({
      status: 'draft',
      version: 1,
      location_id: practice.locationId,
      patient_id: body.patient.id,
      client_id: body.client.id,
      reported_by_client_id: body.client.id,
      veterinarian_id: vet.userId,
      reason_for_visit: null,
      finalised_by: null,
      care_relationship_id: null,
      started_before_now: true,
    })
    const before = await counts()
    const again = await start(visitId, body)
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ clientId: body.client.id, patientId: body.patient.id, visitId })
    expect(await counts()).toEqual(before)
  })

  it('Start visit for an existing client and patient: the owner is the client; a visit id already used for another patient is refused', async () => {
    const first = await started()
    const visitId = uuidv7()
    const existing = {
      client: { type: 'existing', id: first.clientId },
      patient: { type: 'existing', id: first.patientId },
    }

    expect((await start(visitId, existing)).status).toBe(200)
    expect(await visitRow(visitId)).toMatchObject({ client_id: first.clientId, reported_by_client_id: first.clientId })

    const other = await started()
    const reused = {
      client: { type: 'existing', id: other.clientId },
      patient: { type: 'existing', id: other.patientId },
    }
    const before = await counts()
    expect((await start(visitId, reused)).status).toBe(409)
    expect(await counts()).toEqual(before)
  })

  it('Start visit by a receptionist or an assistant is refused and writes nothing, the client and patient included', async () => {
    for (const login of [desk, assistant]) {
      const before = await counts()
      const response = await start(uuidv7(), registration(), login)
      expect(response.status, login.handle).toBe(403)
      expect(await counts()).toEqual(before)
    }
  })

  it('reads the visit with what its header shows: the patient, its species and sex, the owner and phone, the vet, the six sections', async () => {
    const { visitId, patientId, clientId } = await started()

    const response = await read(visitId, desk)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      id: visitId,
      status: 'draft',
      version: 1,
      startedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      finalisedAt: null,
      veterinarian: { id: vet.userId, displayName: 'Leyla Həsənova' },
      patient: {
        id: patientId,
        name: 'Şəkər',
        species: { az: 'İt', ru: 'Собака', en: 'Dog' },
        breed: null,
        sex: 'female',
        isNeutered: true,
        birthDate: '2022-03-01',
        birthDateIsEstimate: false,
      },
      owner: {
        id: clientId,
        firstName: 'Aysel',
        lastName: 'Məmmədova',
        patronymic: 'Rəşad qızı',
        phone: '+994 50 123 45 67',
      },
      note: {
        reasonForVisit: '',
        anamnesis: '',
        examination: '',
        diagnosis: '',
        treatment: '',
        recommendations: '',
      },
    })
    expect((await read(uuidv7())).status).toBe(404)
  })

  it('a draft save with the current version saves the six sections and bumps the version; with a stale one it answers 412 and changes nothing', async () => {
    const { visitId } = await started()

    const saved = await saveNote(visitId, 1, note())

    expect(saved.status).toBe(200)
    expect(await saved.json()).toEqual({ version: 2 })
    expect(((await (await read(visitId)).json()) as { note: unknown; version: number }).note).toEqual(note())
    const before = await counts()
    const stale = await saveNote(visitId, 1, note({ treatment: 'Something else' }))
    expect(stale.status).toBe(412)
    expect(await counts()).toEqual(before)
    expect(((await (await read(visitId)).json()) as { note: { treatment: string } }).note.treatment).toBe(
      'Fluids 100 ml s.c.',
    )
    // A save without its version is refused before it is read.
    const unversioned = await practice.request(vet, `/visits/${visitId}/note`, { method: 'PUT', body: note() })
    expect(unversioned.status).toBe(400)
  })

  it("an assistant saves the sections into a draft; the API refuses the assistant's completion and cancel, and a receptionist's save", async () => {
    const { visitId } = await started()

    expect((await saveNote(visitId, 1, note(), assistant)).status).toBe(200)
    expect((await complete(visitId, 2, assistant)).status).toBe(403)
    expect((await cancel(visitId, 2, assistant)).status).toBe(403)
    expect((await saveNote(visitId, 2, note(), desk)).status).toBe(403)
    expect(await visitRow(visitId)).toMatchObject({ status: 'draft', version: 2 })
  })

  /** The care relationships of a patient: their vet, how far out they lapse from the visit, and whether they are open. */
  const relationshipsOf = async (patientId: string, visitId: string) =>
    (
      await migrator.query(
        `select c.id, c.veterinarian_id, c.ended_at is null as open,
                c.lapses_at = e.finalised_at + interval '12 months' as twelve_months_after
         from ${schema()}.care_relationship c, ${schema()}.encounter e
         where c.patient_id = $1 and e.id = $2 order by c.created_at`,
        [patientId, visitId],
      )
    ).rows

  it('completing a visit with a reason creates the care relationship lapsing twelve months later, and the next completion extends that one (AC-14)', async () => {
    const { visitId, patientId, clientId } = await started()
    await saveNote(visitId, 1, note())

    const completed = await complete(visitId, 2)

    expect(completed.status).toBe(200)
    expect(await completed.json()).toEqual({ version: 3 })
    const [relationship] = await relationshipsOf(patientId, visitId)
    expect(await relationshipsOf(patientId, visitId)).toEqual([
      { id: expect.any(String), veterinarian_id: vet.userId, open: true, twelve_months_after: true },
    ])
    expect(await visitRow(visitId)).toMatchObject({
      status: 'finalised',
      finalised_by: vet.userId,
      care_relationship_id: relationship?.id,
    })
    const visit = (await (await read(visitId)).json()) as { status: string; finalisedAt: string | null }
    expect(visit).toMatchObject({ status: 'finalised', finalisedAt: expect.any(String) })

    // The next visit of the same patient extends the open relationship rather than adding one.
    const nextId = uuidv7()
    const existing = { client: { type: 'existing', id: clientId }, patient: { type: 'existing', id: patientId } }
    expect((await start(nextId, existing)).status).toBe(200)
    await saveNote(nextId, 1, note())
    expect((await complete(nextId, 2)).status).toBe(200)
    expect(await relationshipsOf(patientId, nextId)).toEqual([
      { id: relationship?.id, veterinarian_id: vet.userId, open: true, twelve_months_after: true },
    ])
  })

  it("under delegation a colleague's current relationship with the patient is extended, not doubled; with delegation off the completing vet's own is created (spec 0002, Value sourcing; AC-14)", async () => {
    const { visitId, patientId, clientId } = await started()
    await saveNote(visitId, 1, note())
    await complete(visitId, 2)
    const [leylas] = await relationshipsOf(patientId, visitId)
    const existing = { client: { type: 'existing', id: clientId }, patient: { type: 'existing', id: patientId } }
    /** A visit of the same patient started, noted and completed by the colleague; its id. */
    const completedByColleague = async () => {
      const nextId = uuidv7()
      expect((await start(nextId, existing, colleague)).status).toBe(200)
      await saveNote(nextId, 1, note(), colleague)
      expect((await complete(nextId, 2, colleague)).status).toBe(200)
      return nextId
    }

    const second = await completedByColleague()
    expect(await relationshipsOf(patientId, second)).toEqual([
      { id: leylas?.id, veterinarian_id: vet.userId, open: true, twelve_months_after: true },
    ])

    await migrator.query(`update ${schema()}.practice_settings set delegation_enabled = false`)
    try {
      const third = await completedByColleague()
      expect(await relationshipsOf(patientId, third)).toEqual([
        { id: leylas?.id, veterinarian_id: vet.userId, open: true, twelve_months_after: false },
        { id: expect.any(String), veterinarian_id: colleague.userId, open: true, twelve_months_after: true },
      ])
    } finally {
      await migrator.query(`update ${schema()}.practice_settings set delegation_enabled = true`)
    }
  })

  it('Complete visit with a blank reason is refused naming the rule, and leaves no care relationship behind', async () => {
    const { visitId, patientId } = await started()
    await saveNote(visitId, 1, note({ reasonForVisit: '   ' }))

    const response = await complete(visitId, 2)

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'vetora.reason_for_visit_required' })
    expect(await visitRow(visitId)).toMatchObject({ status: 'draft', version: 2 })
    expect(await relationshipsOf(patientId, visitId)).toEqual([])
  })

  it('a completed visit is read only: a save, a second completion and a cancel are refused as frozen (AC-2, CR-1)', async () => {
    const { visitId } = await started()
    await saveNote(visitId, 1, note())
    await complete(visitId, 2)
    const before = await counts()

    for (const [label, response] of [
      ['save', await saveNote(visitId, 3, note({ treatment: 'Changed' }))],
      ['complete', await complete(visitId, 3)],
      ['cancel', await cancel(visitId, 3)],
    ] as const) {
      expect(response.status, label).toBe(409)
      expect(await response.json(), label).toMatchObject({ code: 'vetora.frozen_record' })
    }
    expect(await counts()).toEqual(before)
    expect(await visitRow(visitId)).toMatchObject({ status: 'finalised', version: 3 })
  })

  it('Complete visit or Cancel visit against a stale version answers 412 and changes nothing', async () => {
    const { visitId } = await started()
    await saveNote(visitId, 1, note())

    expect((await complete(visitId, 1)).status).toBe(412)
    expect((await cancel(visitId, 1)).status).toBe(412)
    expect(await visitRow(visitId)).toMatchObject({ status: 'draft', version: 2 })
  })

  it('Cancel visit discards a draft, which then reads as gone', async () => {
    const { visitId } = await started()

    const response = await cancel(visitId, 1)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ version: 2 })
    expect(await visitRow(visitId)).toMatchObject({ status: 'discarded' })
    expect((await read(visitId)).status).toBe(404)
    expect((await saveNote(visitId, 2, note())).status).toBe(404)
  })

  it("Visits today lists the day's visits at the request's location in the practice's time zone, newest first: one a minute into the practice's day, still yesterday in UTC, is listed; one a minute before it, and a cancelled one, are not", async () => {
    const other = await migrator.query<{ id: string }>(
      `insert into ${schema()}.location (name) values ('Yasamal') returning id`,
    )
    const yasamal = other.rows[0]?.id as string
    // The practice's day begins at midnight in Baku: 20:00 UTC the day before.
    const bounds = await migrator.query<{ day: string; start: Date }>(
      `select (now() at time zone 'Asia/Baku')::date::text as day,
              ((now() at time zone 'Asia/Baku')::date::timestamp at time zone 'Asia/Baku') as start`,
    )
    const { day, start: dayStart } = bounds.rows[0] as { day: string; start: Date }
    const visits = {
      early: await started(),
      late: await started(),
      earlier: await started(),
      cancelled: await started(),
    }
    const elsewhere = await started(yasamal)
    const startAt = (visitId: string, at: Date) =>
      migrator.query(`update ${schema()}.encounter set started_at = $2 where id = $1`, [visitId, at])
    await startAt(visits.early.visitId, new Date(dayStart.getTime() + 60_000))
    await startAt(visits.earlier.visitId, new Date(dayStart.getTime() - 60_000))
    await cancel(visits.cancelled.visitId, 1)
    expect(new Date(dayStart.getTime() + 60_000).toISOString().slice(0, 10)).not.toBe(day)

    const response = await practice.request(desk, '/visits')

    expect(response.status).toBe(200)
    const body = (await response.json()) as { day: string; visits: { id: string }[] }
    expect(body.day).toBe(day)
    const ids = body.visits.map((visit) => visit.id)
    expect(ids).toContain(visits.early.visitId)
    expect(ids).toContain(visits.late.visitId)
    expect(ids).not.toContain(visits.earlier.visitId)
    expect(ids).not.toContain(visits.cancelled.visitId)
    expect(ids).not.toContain(elsewhere.visitId)
    // Newest first: the one started a minute into the day is last.
    expect(ids.at(-1)).toBe(visits.early.visitId)
    expect(body.visits.find((visit) => visit.id === visits.late.visitId)).toEqual({
      id: visits.late.visitId,
      status: 'draft',
      startedAt: expect.any(String),
      patient: { id: visits.late.patientId, name: 'Şəkər' },
      client: { id: visits.late.clientId, firstName: 'Aysel', lastName: 'Məmmədova', patronymic: 'Rəşad qızı' },
      veterinarian: { id: vet.userId, displayName: 'Leyla Həsənova' },
      invoice: 'none',
    })
    const atYasamal = (await (await practice.request(desk, '/visits', { location: yasamal })).json()) as {
      visits: { id: string }[]
    }
    expect(atYasamal.visits.map((visit) => visit.id)).toEqual([elsewhere.visitId])
  })
})
