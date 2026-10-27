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
 * Registering a client and a pet through the API (#21; spec #18, stories 23 to 26 and 29 to 35), seam 2: the real
 * app, a provisioned practice, a receptionist's session. What the request context refuses is practice-context.test.ts.
 */
describe.skipIf(!databaseTestsEnabled())('registering a client and a pet (#21, seam 2)', () => {
  let urls: TestDatabaseUrls
  let migrator: TestClient
  let practice: ApiPractice
  let desk: Login
  let species: { id: string; code: string; breeds: { id: string; name: Record<string, string | null> }[] }[]
  let dog: string
  let cat: string

  beforeAll(async () => {
    urls = testDatabaseUrls()
    await resetTestDatabase(urls)
    await migrate({ url: urls.migrator })
    migrator = await connectTestClient(urls.migrator, 'registration.test')
    practice = await provisionApiPractice(urls, { name: 'Alfa Vet', timeZone: 'Asia/Baku' })
    desk = await practice.addStaff('aysel', ['receptionist'], { name: 'Aysel Quliyeva' })
    const response = await practice.request(desk, '/species')
    species = ((await response.json()) as { species: typeof species }).species
    dog = species.find((item) => item.code === 'dog')?.id as string
    cat = species.find((item) => item.code === 'cat')?.id as string
  }, 60_000)

  afterAll(async () => {
    await practice?.drop()
    await migrator?.end()
  })

  const schema = () => ident(practice.schema)
  const register = (body: unknown, login = desk) => practice.request(login, '/registrations', { method: 'PUT', body })
  const lookUp = (phone: string) => practice.request(desk, '/clients/lookup', { method: 'POST', body: { phone } })

  const newClient = (overrides: Record<string, unknown> = {}) => ({
    type: 'new',
    id: uuidv7(),
    firstName: 'Aysel',
    lastName: 'Məmmədova',
    patronymic: 'Rəşad qızı',
    phone: '+994 50 123 45 67',
    preferredLanguage: 'az',
    ...overrides,
  })
  const newPatient = (overrides: Record<string, unknown> = {}) => ({
    type: 'new',
    id: uuidv7(),
    name: 'Şəkər',
    speciesId: dog,
    sex: 'female',
    birthDate: '2022-03-01',
    birthDateIsEstimate: true,
    isNeutered: true,
    colour: 'Ağ',
    ...overrides,
  })

  /** The rows the practice holds, counted, with the audit log: what a retry must leave as it was. */
  async function counts() {
    const rows = await migrator.query<Record<string, number>>(
      `select (select count(*)::int from ${schema()}.client) as client,
              (select count(*)::int from ${schema()}.client_contact) as client_contact,
              (select count(*)::int from ${schema()}.patient) as patient,
              (select count(*)::int from ${schema()}.ownership) as ownership,
              (select count(*)::int from ${schema()}.audit_event) as audit_event`,
    )
    return rows.rows[0]
  }

  it("lists the seven species in their order with their three names, dog and cat first, as the person's language picks from", async () => {
    expect(species.map((item) => item.code)).toEqual(['dog', 'cat', 'rabbit', 'bird', 'reptile', 'rodent', 'other'])
    expect(species[0]).toMatchObject({
      name: { az: 'İt', ru: 'Собака', en: 'Dog' },
      clinicallySupported: true,
      breeds: [],
    })
  })

  it("registers a new client and pet: one client, one contact with the normalised phone, one patient and one owner row from the practice's today, each audited as the receptionist; the same request again changes nothing", async () => {
    const body = { client: newClient(), patient: newPatient() }

    const response = await register(body)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ clientId: body.client.id, patientId: body.patient.id })
    const client = await migrator.query(
      `select kind, first_name, last_name, patronymic, preferred_language, status from ${schema()}.client where id = $1`,
      [body.client.id],
    )
    expect(client.rows).toEqual([
      {
        kind: 'person',
        first_name: 'Aysel',
        last_name: 'Məmmədova',
        patronymic: 'Rəşad qızı',
        preferred_language: 'az',
        status: 'active',
      },
    ])
    const contacts = await migrator.query(
      `select kind, value, value_normalised, is_primary from ${schema()}.client_contact where client_id = $1`,
      [body.client.id],
    )
    expect(contacts.rows).toEqual([
      { kind: 'phone', value: '+994 50 123 45 67', value_normalised: '+994501234567', is_primary: true },
    ])
    const patient = await migrator.query(
      `select name, species_id, breed_id, sex, birth_date::text, birth_date_is_estimate, is_neutered, colour,
              microchip_number, life_status, status
       from ${schema()}.patient where id = $1`,
      [body.patient.id],
    )
    expect(patient.rows).toEqual([
      {
        name: 'Şəkər',
        species_id: dog,
        breed_id: null,
        sex: 'female',
        birth_date: '2022-03-01',
        birth_date_is_estimate: true,
        is_neutered: true,
        colour: 'Ağ',
        microchip_number: null,
        life_status: 'alive',
        status: 'active',
      },
    ])
    const owner = await migrator.query(
      `select client_id, role, valid_from = (now() at time zone 'Asia/Baku')::date as from_today, valid_to
       from ${schema()}.ownership where patient_id = $1`,
      [body.patient.id],
    )
    expect(owner.rows).toEqual([{ client_id: body.client.id, role: 'owner', from_today: true, valid_to: null }])
    const audit = await migrator.query<{ table_name: string; actor_id: string; source: string; has_request: boolean }>(
      `select table_name, actor_id, source, request_id is not null as has_request from ${schema()}.audit_event
       where row_id in ($1, $2)
          or row_id in (select id from ${schema()}.client_contact where client_id = $1)
          or row_id in (select id from ${schema()}.ownership where patient_id = $2)
       order by id`,
      [body.client.id, body.patient.id],
    )
    expect(audit.rows.map((row) => row.table_name)).toEqual(['client', 'client_contact', 'patient', 'ownership'])
    for (const row of audit.rows) {
      expect(row, row.table_name).toMatchObject({ actor_id: desk.userId, source: 'request', has_request: true })
    }

    const before = await counts()
    const again = await register(body)

    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ clientId: body.client.id, patientId: body.patient.id })
    expect(await counts()).toEqual(before)
  })

  it('finds the client by any common way of writing the same Azerbaijani number, with the patient they own', async () => {
    const body = { client: newClient({ phone: '055 987 65 43' }), patient: newPatient({ name: 'Bəbir' }) }
    expect((await register(body)).status).toBe(200)

    for (const written of [
      '+994 55 987 65 43',
      '+994559876543',
      '994559876543',
      '00994559876543',
      '0559876543',
      '055 987-65-43',
      '(055) 987 65 43',
      '55 987 65 43',
    ]) {
      const response = await lookUp(written)
      expect(response.status, written).toBe(200)
      expect(await response.json(), written).toEqual({
        phone: '+994559876543',
        clients: [
          {
            id: body.client.id,
            firstName: 'Aysel',
            lastName: 'Məmmədova',
            patronymic: 'Rəşad qızı',
            preferredLanguage: 'az',
            patients: [{ id: body.patient.id, name: 'Bəbir', speciesId: dog, breedId: null, sex: 'female' }],
          },
        ],
      })
    }
  })

  it('answers no client for an unknown number, and refuses what is not a phone number', async () => {
    const unknown = await lookUp('070 555 01 02')
    expect(unknown.status).toBe(200)
    expect(await unknown.json()).toEqual({ phone: '+994705550102', clients: [] })

    for (const phone of ['12', 'abc', '+994 55 987 65 4']) {
      const refused = await lookUp(phone)
      expect(refused.status, phone).toBe(400)
      expect(refused.headers.get('content-type')).toBe('application/problem+json')
    }
  })

  it('saves a second client registered on a number another client has, and the lookup then answers both in the order they came (story 26)', async () => {
    const first = { client: newClient({ phone: '051 222 33 44' }), patient: newPatient({ name: 'Toplan' }) }
    const second = {
      client: newClient({ firstName: 'Rəşad', lastName: 'Əliyev', patronymic: null, phone: '+994512223344' }),
      patient: newPatient({ name: 'Mestan', speciesId: cat, sex: 'male', birthDate: null }),
    }
    expect((await register(first)).status).toBe(200)

    expect((await register(second)).status).toBe(200)

    const found = (await (await lookUp('0512223344')).json()) as { clients: { id: string; patients: unknown[] }[] }
    expect(found.clients.map((client) => client.id)).toEqual([first.client.id, second.client.id])
    expect(found.clients.map((client) => client.patients.length)).toEqual([1, 1])
  })

  it('registers a new patient for a client found by phone, owned by that client from today', async () => {
    const first = { client: newClient({ phone: '077 111 22 33' }), patient: newPatient({ name: 'Ləkə' }) }
    expect((await register(first)).status).toBe(200)
    const second = { client: { type: 'existing', id: first.client.id }, patient: newPatient({ name: 'Pambıq' }) }

    expect((await register(second)).status).toBe(200)

    const found = (await (await lookUp('0771112233')).json()) as { clients: { patients: { name: string }[] }[] }
    expect(found.clients).toHaveLength(1)
    expect(found.clients[0]?.patients.map((patient) => patient.name)).toEqual(['Ləkə', 'Pambıq'])
    // An existing patient the client owns changes nothing; one they do not own is refused.
    expect(
      (await register({ client: second.client, patient: { type: 'existing', id: second.patient.id } })).status,
    ).toBe(200)
    const stranger = {
      client: newClient({ phone: '077 999 88 77' }),
      patient: { type: 'existing', id: second.patient.id },
    }
    expect((await register(stranger)).status).toBe(409)
  })

  it('refuses blank required fields, a microchip already recorded for another patient, and a birth date after today, and keeps nothing of them', async () => {
    const before = await counts()
    for (const [label, body] of [
      ['blank last name', { client: newClient({ lastName: '  ' }), patient: newPatient() }],
      ['blank pet name', { client: newClient(), patient: newPatient({ name: '' }) }],
      ['no species', { client: newClient(), patient: newPatient({ speciesId: undefined }) }],
      ['no phone', { client: newClient({ phone: '' }), patient: newPatient() }],
      ['a microchip of 14 digits', { client: newClient(), patient: newPatient({ microchipNumber: '64309410012345' }) }],
    ] as const) {
      const response = await register(body)
      expect(response.status, label).toBe(400)
    }
    expect(await counts()).toEqual(before)

    const chipped = {
      client: newClient({ phone: '050 333 44 55' }),
      patient: newPatient({ microchipNumber: '643094100123456' }),
    }
    expect((await register(chipped)).status).toBe(200)
    const taken = await register({
      client: newClient({ phone: '050 333 44 66' }),
      patient: newPatient({ microchipNumber: '643094100123456' }),
    })
    expect(taken.status).toBe(409)
    expect(await taken.json()).toMatchObject({ errors: [{ path: ['patient', 'microchipNumber'], code: 'taken' }] })

    const future = await register({ client: newClient(), patient: newPatient({ birthDate: '2999-01-01' }) })
    expect(future.status).toBe(400)
    expect(await future.json()).toMatchObject({ errors: [{ path: ['patient', 'birthDate'], code: 'future' }] })
  })

  it('adds a breed inline with one name in the language given, lists it under its species, takes it on a patient, and changes nothing on a retry; a second breed of the same Russian name is refused', async () => {
    const id = uuidv7()
    const add = (body: unknown, breedId = id) => practice.request(desk, `/breeds/${breedId}`, { method: 'PUT', body })

    const created = await add({ speciesId: dog, language: 'ru', name: 'Кавказская овчарка' })

    expect(created.status).toBe(201)
    const breed = { id, speciesId: dog, name: { az: null, ru: 'Кавказская овчарка', en: null } }
    expect(await created.json()).toEqual(breed)
    const again = await add({ speciesId: dog, language: 'ru', name: 'Кавказская овчарка' })
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual(breed)
    const listed = (await (await practice.request(desk, '/species')).json()) as { species: typeof species }
    expect(listed.species.find((item) => item.id === dog)?.breeds).toEqual([{ id, name: breed.name }])

    const duplicate = await add({ speciesId: dog, language: 'ru', name: 'Кавказская овчарка' }, uuidv7())
    expect(duplicate.status).toBe(409)
    expect((await add({ speciesId: uuidv7(), language: 'az', name: 'Qafqaz' }, uuidv7())).status).toBe(404)

    const withBreed = { client: newClient({ phone: '050 777 66 55' }), patient: newPatient({ breedId: id }) }
    expect((await register(withBreed)).status).toBe(200)
    // A breed of another species is not this patient's.
    const wrongSpecies = {
      client: newClient({ phone: '050 777 66 44' }),
      patient: newPatient({ speciesId: cat, breedId: id }),
    }
    expect((await register(wrongSpecies)).status).toBe(404)
  })
})
