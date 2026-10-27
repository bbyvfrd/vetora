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
 * The vital signs of a visit through the API (#23; spec #18, stories 39 to 42), seam 2: recording each kind, timed now
 * and measured by the actor; the plausible ranges and units the contracts define; the matrix (a weight for whoever is
 * free, the rest for an assistant or a vet); the visit's readings, and the patient's last weight across their visits.
 * What the database refuses whatever the API does is clinical-record.test.ts.
 */
describe.skipIf(!databaseTestsEnabled())('the vital signs of a visit (#23, seam 2)', () => {
  let urls: TestDatabaseUrls
  let migrator: TestClient
  let practice: ApiPractice
  let vet: Login
  let assistant: Login
  let desk: Login
  let groomer: Login
  let dog: string

  beforeAll(async () => {
    urls = testDatabaseUrls()
    await resetTestDatabase(urls)
    await migrate({ url: urls.migrator })
    migrator = await connectTestClient(urls.migrator, 'observations.test')
    await migrator.query("select set_config('app.migration', 'observations.test', false)")
    practice = await provisionApiPractice(urls, { name: 'Alfa Vet', timeZone: 'Asia/Baku' })
    vet = await practice.addStaff('leyla', ['veterinarian'], { name: 'Leyla Həsənova' })
    assistant = await practice.addStaff('tural', ['assistant'], { name: 'Tural Quliyev' })
    desk = await practice.addStaff('aysel', ['receptionist'], { name: 'Aysel Quliyeva' })
    groomer = await practice.addStaff('nigar', ['groomer'], { name: 'Nigar Əliyeva' })
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

  /** A visit started by the vet, for a new client and dog, or for a patient already registered; its ids. */
  async function started(patient?: { clientId: string; patientId: string }) {
    const visitId = uuidv7()
    const body = patient
      ? { client: { type: 'existing', id: patient.clientId }, patient: { type: 'existing', id: patient.patientId } }
      : {
          client: {
            type: 'new',
            id: uuidv7(),
            firstName: 'Aysel',
            lastName: 'Məmmədova',
            phone: `+994 50 ${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
            preferredLanguage: 'az',
          },
          patient: {
            type: 'new',
            id: uuidv7(),
            name: 'Şəkər',
            speciesId: dog,
            sex: 'female',
            birthDateIsEstimate: false,
            isNeutered: true,
          },
        }
    const response = await practice.request(vet, `/visits/${visitId}`, { method: 'PUT', body })
    expect(response.status).toBe(200)
    const started = (await response.json()) as { clientId: string; patientId: string }
    return { visitId, clientId: started.clientId, patientId: started.patientId }
  }

  const record = (visitId: string, body: unknown, login: Login = assistant, id = uuidv7()) =>
    practice.request(login, `/visits/${visitId}/observations/${id}`, { method: 'PUT', body })
  const readings = (visitId: string, login: Login = vet) => practice.request(login, `/visits/${visitId}/observations`)
  const lastWeight = (patientId: string, login: Login = vet) =>
    practice.request(login, `/patients/${patientId}/last-weight`)

  const rows = async (visitId: string) =>
    (
      await migrator.query<Record<string, unknown>>(
        `select kind, value::text as value, unit, measured_by, location_id, patient_id,
                occurred_at > now() - interval '1 minute' and occurred_at <= now() as timed_now
         from ${schema()}.clinical_observation where encounter_id = $1 order by occurred_at, id`,
        [visitId],
      )
    ).rows

  const audits = async () =>
    (
      await migrator.query<{ count: number }>(
        `select count(*)::int as count from ${schema()}.audit_event where table_name = 'clinical_observation'`,
      )
    ).rows[0]?.count

  it("records each of the four kinds with its value and unit, timed now, measured by the actor, at the request's location", async () => {
    const { visitId, patientId } = await started()
    const sent = [
      { kind: 'weight', value: 4.2, unit: 'kg' },
      { kind: 'temperature', value: 38.6, unit: '°C' },
      { kind: 'pulse', value: 96, unit: '/min' },
      { kind: 'respiratory_rate', value: 24, unit: '/min' },
    ]

    for (const reading of sent) {
      const id = uuidv7()
      const response = await record(visitId, reading, assistant, id)
      expect(response.status, reading.kind).toBe(200)
      expect(await response.json()).toMatchObject({
        id,
        ...reading,
        measuredBy: { id: assistant.userId, displayName: 'Tural Quliyev' },
      })
    }

    const common = { measured_by: assistant.userId, location_id: practice.locationId, patient_id: patientId }
    expect(await rows(visitId)).toEqual([
      { kind: 'weight', value: '4.200', unit: 'kg', ...common, timed_now: true },
      { kind: 'temperature', value: '38.600', unit: '°C', ...common, timed_now: true },
      { kind: 'pulse', value: '96.000', unit: '/min', ...common, timed_now: true },
      { kind: 'respiratory_rate', value: '24.000', unit: '/min', ...common, timed_now: true },
    ])
  })

  it('the same reading again changes nothing and answers as the first did; its id on another visit is refused', async () => {
    const { visitId } = await started()
    const id = uuidv7()
    const first = await record(visitId, { kind: 'weight', value: 4.2, unit: 'kg' }, assistant, id)
    const before = await audits()

    const again = await record(visitId, { kind: 'weight', value: 4.2, unit: 'kg' }, assistant, id)

    expect(again.status).toBe(200)
    expect(await again.json()).toEqual(await first.json())
    expect(await rows(visitId)).toHaveLength(1)
    expect(await audits()).toBe(before)

    const other = await started()
    const taken = await record(other.visitId, { kind: 'weight', value: 4.2, unit: 'kg' }, assistant, id)
    expect(taken.status).toBe(409)
    expect(await rows(other.visitId)).toEqual([])
  })

  it('a reading without a unit, in another unit, or outside its plausible range is refused, and nothing is stored', async () => {
    const { visitId } = await started()

    for (const body of [
      { kind: 'weight', value: 4.2 },
      { kind: 'weight', value: 4.2, unit: 'g' },
      { kind: 'temperature', value: 38.6, unit: 'kg' },
      { kind: 'weight', value: 0, unit: 'kg' },
      { kind: 'weight', value: 420, unit: 'kg' },
      { kind: 'temperature', value: 386, unit: '°C' },
      { kind: 'pulse', value: 9600, unit: '/min' },
      { kind: 'respiratory_rate', value: 0, unit: '/min' },
      { kind: 'body_condition', value: 5, unit: '/9' },
    ]) {
      const response = await record(visitId, body, vet)
      expect(response.status, JSON.stringify(body)).toBe(400)
      expect(response.headers.get('content-type')).toContain('application/problem+json')
    }
    expect(await rows(visitId)).toEqual([])
  })

  it('a receptionist records a weight and is refused a temperature; a groomer and a manager are refused both (the matrix)', async () => {
    const { visitId } = await started()
    const weight = { kind: 'weight', value: 4.2, unit: 'kg' }
    const temperature = { kind: 'temperature', value: 38.6, unit: '°C' }

    expect((await record(visitId, weight, desk)).status).toBe(200)
    expect((await record(visitId, temperature, desk)).status).toBe(403)
    for (const login of [groomer, practice.manager]) {
      expect((await record(visitId, weight, login)).status).toBe(403)
      expect((await record(visitId, temperature, login)).status).toBe(403)
    }

    expect((await rows(visitId)).map((row) => [row.kind, row.measured_by])).toEqual([['weight', desk.userId]])
  })

  it("PT-2: a corrected weight is a second reading and both remain; the visit's readings list them oldest first with who measured", async () => {
    const { visitId } = await started()
    await record(visitId, { kind: 'weight', value: 4.2, unit: 'kg' }, desk)
    await record(visitId, { kind: 'weight', value: 4.3, unit: 'kg' }, assistant)

    const response = await readings(visitId, desk)

    expect(response.status).toBe(200)
    const { observations } = (await response.json()) as {
      observations: { kind: string; value: number; measuredBy: { displayName: string }; occurredAt: string }[]
    }
    expect(observations.map(({ kind, value, measuredBy }) => [kind, value, measuredBy.displayName])).toEqual([
      ['weight', 4.2, 'Aysel Quliyeva'],
      ['weight', 4.3, 'Tural Quliyev'],
    ])
    expect(Date.parse(observations[0]?.occurredAt ?? '')).not.toBeNaN()
    // A groomer reads nothing of feature 5 (story 72).
    expect((await readings(visitId, groomer)).status).toBe(403)
  })

  it('AC-2: a reading on a completed visit is refused with vetora.frozen_record; a cancelled or unknown visit is not found', async () => {
    const { visitId } = await started()
    await record(visitId, { kind: 'weight', value: 4.2, unit: 'kg' })
    const saved = await practice.request(vet, `/visits/${visitId}/note`, {
      method: 'PUT',
      headers: { 'if-match': '"1"' },
      body: {
        reasonForVisit: 'Annual check',
        anamnesis: '',
        examination: '',
        diagnosis: '',
        treatment: '',
        recommendations: '',
      },
    })
    const { version } = (await saved.json()) as { version: number }
    const completed = await practice.request(vet, `/visits/${visitId}/complete`, {
      method: 'POST',
      headers: { 'if-match': `"${version}"` },
    })
    expect(completed.status).toBe(200)

    const refused = await record(visitId, { kind: 'temperature', value: 38.6, unit: '°C' })

    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ code: 'vetora.frozen_record' })
    expect((await rows(visitId)).map((row) => row.kind)).toEqual(['weight'])

    const cancelled = await started()
    const cancel = await practice.request(vet, `/visits/${cancelled.visitId}/cancel`, {
      method: 'POST',
      headers: { 'if-match': '"1"' },
    })
    expect(cancel.status).toBe(200)
    expect((await record(cancelled.visitId, { kind: 'weight', value: 4.2, unit: 'kg' })).status).toBe(404)
    expect((await readings(cancelled.visitId)).status).toBe(404)
    expect((await record(uuidv7(), { kind: 'weight', value: 4.2, unit: 'kg' })).status).toBe(404)
  })

  it("the patient's last weight is the newest weight across their visits; a cancelled visit's weight does not count; none is null", async () => {
    const first = await started()
    const patient = { clientId: first.clientId, patientId: first.patientId }
    expect(await (await lastWeight(patient.patientId, desk)).json()).toEqual({ lastWeight: null })

    await record(first.visitId, { kind: 'weight', value: 4.1, unit: 'kg' })
    await record(first.visitId, { kind: 'weight', value: 4.2, unit: 'kg' })
    const second = await started(patient)
    const newest = uuidv7()
    await record(second.visitId, { kind: 'weight', value: 4.5, unit: 'kg' }, desk, newest)
    // A later temperature is not a weight.
    await record(second.visitId, { kind: 'temperature', value: 38.6, unit: '°C' })
    // A visit opened by mistake and cancelled reads as gone, its weight with it.
    const mistaken = await started(patient)
    await record(mistaken.visitId, { kind: 'weight', value: 9.9, unit: 'kg' })
    await practice.request(vet, `/visits/${mistaken.visitId}/cancel`, {
      method: 'POST',
      headers: { 'if-match': '"1"' },
    })

    const response = await lastWeight(patient.patientId, desk)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      lastWeight: { id: newest, kind: 'weight', value: 4.5, unit: 'kg', measuredBy: { displayName: 'Aysel Quliyeva' } },
    })
    // The visit page names its own visit: the weight from before it, so a change shows (story 41).
    const before = await practice.request(
      desk,
      `/patients/${patient.patientId}/last-weight?excludingVisit=${second.visitId}`,
    )
    expect(await before.json()).toMatchObject({ lastWeight: { kind: 'weight', value: 4.2 } })
    expect((await lastWeight(patient.patientId, groomer)).status).toBe(403)
  })

  it('fails closed: a body whose kind cannot be read takes the stricter action, so a receptionist is refused it', async () => {
    const { visitId } = await started()

    for (const body of [
      {},
      { kind: 'mood', value: 4.2, unit: 'kg' },
      { kind: 'body_condition', value: 5, unit: '/9' },
    ]) {
      expect((await record(visitId, body, desk)).status, JSON.stringify(body)).toBe(403)
    }
    const unreadable = await practice.request(desk, `/visits/${visitId}/observations/${uuidv7()}`, {
      method: 'PUT',
      body: 'not json',
    })
    expect(unreadable.status).toBe(403)
    // The same bodies reach validation for an assistant, who holds both actions.
    expect((await record(visitId, {}, assistant)).status).toBe(400)
    expect(await rows(visitId)).toEqual([])
  })
})
