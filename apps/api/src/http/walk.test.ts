import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadServices } from '../modules/inventory/index.js'
import { migrate } from '../platform/db/migrator.js'
import {
  databaseTestsEnabled,
  resetTestDatabase,
  TEST_PASSWORD,
  type TestDatabaseUrls,
  testDatabaseUrls,
} from '../platform/db/test-support.js'
import { uuidv7 } from '../platform/ids.js'
import { type ApiPractice, call, type Login, provisionApiPractice, sessionCookie, signIn } from '../test-support.js'

/**
 * The whole visit through the real API, in one walk (spec #18, Testing Decisions: seam 2, "the highest seam"; story
 * 76; #26): a vet signs in and reads `/api/me`, registers a walk in client and pet, finds them again by phone, starts
 * the visit, records the four vital signs, saves the draft note and completes it, adds two services, issues the
 * invoice, takes a part payment by cash, reads the owner's Balance due, takes the rest by card, and reads the invoice
 * paid on Visits today. Its cases are one walk in order, each building on the one before, against vetora_test on a
 * practice provisioned through the provisioning code with logins from the staff service. Each step's own refusals are
 * the routes' tests beside it.
 */
describe.skipIf(!databaseTestsEnabled())('the visit end to end (#26, seam 2)', () => {
  let urls: TestDatabaseUrls
  let practice: ApiPractice
  let vet: Login
  let locationId: string
  let dog: string
  const services: Record<'consultation' | 'vaccination', string> = { consultation: '', vaccination: '' }
  const ids = { client: uuidv7(), patient: uuidv7(), visit: uuidv7(), invoice: uuidv7() }
  const phone = '+994 50 321 54 76'
  type InvoiceBody = { id: string; version: number; status: string; number: string | null; remainderMinor: number }
  let invoice: InvoiceBody

  beforeAll(async () => {
    urls = testDatabaseUrls()
    await resetTestDatabase(urls)
    await migrate({ url: urls.migrator })
    practice = await provisionApiPractice(urls, { name: 'Alfa Vet', timeZone: 'Asia/Baku' })
    await practice.addStaff('leyla', ['veterinarian'], { name: 'Leyla Həsənova' })
    const loaded = await loadServices({
      migratorUrl: urls.migrator,
      practiceCode: practice.slug,
      services: [
        {
          names: { az: 'Müayinə', ru: 'Осмотр', en: 'Consultation' },
          category: 'consultation',
          priceMinor: 2500,
          currency: 'AZN',
        },
        {
          names: { az: 'Peyvənd', ru: 'Вакцинация', en: 'Vaccination' },
          category: 'procedure',
          priceMinor: 1850,
          currency: 'AZN',
        },
      ],
    })
    expect(loaded).toMatchObject({ status: 'loaded', added: 2 })
  }, 60_000)

  afterAll(async () => {
    await practice?.drop()
  })

  /** A request as the vet, through the practice's location; the answer's body when it is 200. */
  async function asVet<T>(path: string, options: Parameters<ApiPractice['request']>[2] = {}): Promise<T> {
    const response = await practice.request(vet, path, { location: locationId, ...options })
    expect(response.status, `${options.method ?? 'GET'} ${path}`).toBe(200)
    return (await response.json()) as T
  }
  const ifMatch = (version: number) => ({ 'if-match': `"${version}"` })

  it('signs the vet in, and /api/me names the practice, the roles and the location', async () => {
    const response = await signIn(practice.slug, 'leyla', TEST_PASSWORD)
    expect(response.status).toBe(204)
    vet = { userId: '', handle: 'leyla', password: TEST_PASSWORD, cookie: sessionCookie(response) }

    const me = await call('/api/me', { cookie: vet.cookie })
    expect(me.status).toBe(200)
    const body = (await me.json()) as {
      id: string
      practice: { id: string; roles: string[] }
      locations: { id: string; isDefault: boolean }[]
    }
    expect(body.practice).toMatchObject({ id: practice.practiceId, roles: ['veterinarian'] })
    vet.userId = body.id
    locationId = body.locations.find((location) => location.isDefault)?.id as string
    expect(locationId).toBe(practice.locationId)
  })

  it('registers a walk in client and their dog, and finds them again by phone', async () => {
    const species = await asVet<{ species: { id: string; code: string }[] }>('/species')
    dog = species.species.find((item) => item.code === 'dog')?.id as string
    const registered = await asVet<{ clientId: string; patientId: string }>('/registrations', {
      method: 'PUT',
      body: {
        client: {
          type: 'new',
          id: ids.client,
          firstName: 'Aysel',
          lastName: 'Məmmədova',
          phone,
          preferredLanguage: 'az',
        },
        patient: {
          type: 'new',
          id: ids.patient,
          name: 'Şəkər',
          speciesId: dog,
          sex: 'female',
          birthDateIsEstimate: false,
          isNeutered: true,
        },
      },
    })
    expect(registered).toEqual({ clientId: ids.client, patientId: ids.patient })

    const found = await asVet<{ clients: { id: string; patients: { id: string }[] }[] }>('/clients/lookup', {
      method: 'POST',
      body: { phone: '050 321 54 76' },
    })
    expect(found.clients).toMatchObject([{ id: ids.client, patients: [{ id: ids.patient }] }])
  })

  it('starts the visit, records the four vital signs, saves the draft note and completes it', async () => {
    await asVet(`/visits/${ids.visit}`, {
      method: 'PUT',
      body: { client: { type: 'existing', id: ids.client }, patient: { type: 'existing', id: ids.patient } },
    })
    for (const reading of [
      { kind: 'weight', value: 4.2, unit: 'kg' },
      { kind: 'temperature', value: 38.6, unit: '°C' },
      { kind: 'pulse', value: 110, unit: '/min' },
      { kind: 'respiratory_rate', value: 24, unit: '/min' },
    ]) {
      await asVet(`/visits/${ids.visit}/observations/${uuidv7()}`, { method: 'PUT', body: reading })
    }
    const readings = await asVet<{ observations: { kind: string }[] }>(`/visits/${ids.visit}/observations`)
    expect(readings.observations.map((reading) => reading.kind).sort()).toEqual([
      'pulse',
      'respiratory_rate',
      'temperature',
      'weight',
    ])

    const saved = await asVet<{ version: number }>(`/visits/${ids.visit}/note`, {
      method: 'PUT',
      headers: ifMatch(1),
      body: {
        reasonForVisit: 'Yearly vaccination',
        anamnesis: 'Eats well.',
        examination: 'Healthy.',
        diagnosis: '',
        treatment: 'Vaccinated.',
        recommendations: '',
      },
    })
    const completed = await asVet<{ version: number }>(`/visits/${ids.visit}/complete`, {
      method: 'POST',
      headers: ifMatch(saved.version),
    })
    const visit = await asVet<{ status: string; version: number }>(`/visits/${ids.visit}`)
    expect(visit).toMatchObject({ status: 'finalised', version: completed.version })
  })

  it('adds two services from the price list and issues the invoice: Balance due is its total', async () => {
    const list = await asVet<{ services: { id: string; names: { en: string } }[] }>('/services')
    services.consultation = list.services.find((item) => item.names.en === 'Consultation')?.id as string
    services.vaccination = list.services.find((item) => item.names.en === 'Vaccination')?.id as string
    invoice = await asVet<InvoiceBody>(`/invoices/${ids.invoice}`, {
      method: 'PUT',
      body: {
        visitId: ids.visit,
        patientId: ids.patient,
        clientId: ids.client,
        line: { id: uuidv7(), serviceId: services.consultation, quantity: 1 },
      },
    })
    invoice = await asVet<InvoiceBody>(`/invoices/${ids.invoice}/lines/${uuidv7()}`, {
      method: 'PUT',
      headers: ifMatch(invoice.version),
      body: { serviceId: services.vaccination, quantity: 1 },
    })
    invoice = await asVet<InvoiceBody>(`/invoices/${ids.invoice}/issue`, {
      method: 'POST',
      headers: ifMatch(invoice.version),
    })
    expect(invoice).toMatchObject({ status: 'issued', remainderMinor: 4350 })
    expect(invoice.number).toMatch(/^\d+$/)
    const visit = await asVet<{ owner: { balance: unknown } }>(`/visits/${ids.visit}`)
    expect(visit.owner.balance).toEqual({ amountMinor: 4350, currency: 'AZN' })
  })

  it('takes a part payment by cash: the rest is Balance due beside the owner, and Visits today says partly paid', async () => {
    invoice = await asVet<InvoiceBody>(`/invoices/${ids.invoice}/payments/${uuidv7()}`, {
      method: 'PUT',
      headers: ifMatch(invoice.version),
      body: { amountMinor: 2000, method: 'cash' },
    })
    expect(invoice).toMatchObject({ paidMinor: 2000, remainderMinor: 2350 })
    const visit = await asVet<{ owner: { balance: unknown } }>(`/visits/${ids.visit}`)
    expect(visit.owner.balance).toEqual({ amountMinor: 2350, currency: 'AZN' })
    const today = await asVet<{ visits: { id: string; invoice: string }[] }>('/visits')
    expect(today.visits).toMatchObject([{ id: ids.visit, invoice: 'partly_paid' }])
  })

  it('takes the rest by card: the invoice is paid and nothing is owed', async () => {
    invoice = await asVet<InvoiceBody>(`/invoices/${ids.invoice}/payments/${uuidv7()}`, {
      method: 'PUT',
      headers: ifMatch(invoice.version),
      body: { amountMinor: invoice.remainderMinor, method: 'card' },
    })
    expect(invoice).toMatchObject({ paidMinor: 4350, remainderMinor: 0 })
    const visit = await asVet<{ owner: { balance: unknown } }>(`/visits/${ids.visit}`)
    expect(visit.owner.balance).toEqual({ amountMinor: 0, currency: 'AZN' })
    const today = await asVet<{ visits: { id: string; invoice: string }[] }>('/visits')
    expect(today.visits).toMatchObject([{ id: ids.visit, invoice: 'paid' }])
  })
})
