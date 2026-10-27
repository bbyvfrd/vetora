import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadServices } from '../modules/inventory/index.js'
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
 * A visit's invoice and its payments through the API (#25, #26; spec #18, "Visit and money behaviour": the invoice,
 * Take payment; stories 56 to 69), seam 2: the draft created with its first line from the price list, the names and
 * price it snapshots, quantities changed and lines removed while a draft, Issue invoice with its number and the
 * client's charge, retries and stale versions, Cancel visit with a draft and with an issued invoice, the invoice's
 * state on Visits today, and the matrix; then Take payment, which issues a draft and records the payment, part payments
 * and the owner's Balance due, the refused amounts, and the payment's business day. What the database refuses whatever
 * the API does is src/platform/db/billing.test.ts; the whole visit in one walk is src/http/walk.test.ts.
 */
describe.skipIf(!databaseTestsEnabled())("a visit's invoice (#25, seam 2)", () => {
  let urls: TestDatabaseUrls
  let migrator: TestClient
  let practice: ApiPractice
  let vet: Login
  let desk: Login
  let groomer: Login
  let dog: string
  /** The price list's ids by English name. */
  const services: Record<'consultation' | 'vaccination', string> = { consultation: '', vaccination: '' }

  beforeAll(async () => {
    urls = testDatabaseUrls()
    await resetTestDatabase(urls)
    await migrate({ url: urls.migrator })
    migrator = await connectTestClient(urls.migrator, 'invoices.test')
    await migrator.query("select set_config('app.migration', 'invoices.test', false)")
    practice = await provisionApiPractice(urls, { name: 'Alfa Vet', timeZone: 'Asia/Baku' })
    vet = await practice.addStaff('leyla', ['veterinarian'], { name: 'Leyla Həsənova' })
    desk = await practice.addStaff('aysel', ['receptionist'], { name: 'Aysel Quliyeva' })
    groomer = await practice.addStaff('nigar', ['groomer'], { name: 'Nigar Əliyeva' })
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
    const list = (await (await practice.request(desk, '/services')).json()) as {
      services: { id: string; names: { en: string } }[]
    }
    services.consultation = list.services.find((item) => item.names.en === 'Consultation')?.id as string
    services.vaccination = list.services.find((item) => item.names.en === 'Vaccination')?.id as string
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

  /** A visit started by the vet for a new client and dog; its ids. */
  async function started() {
    const visitId = uuidv7()
    const response = await practice.request(vet, `/visits/${visitId}`, {
      method: 'PUT',
      body: {
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
      },
    })
    expect(response.status).toBe(200)
    const visit = (await response.json()) as { clientId: string; patientId: string }
    return { visitId, clientId: visit.clientId, patientId: visit.patientId }
  }

  type Visit = Awaited<ReturnType<typeof started>>
  type InvoiceBody = {
    id: string
    status: string
    version: number
    number: string | null
    lines: { id: string; description: Record<string, string | null>; quantity: number; totalMinor: number }[]
    totalMinor: number
    paidMinor: number
    remainderMinor: number
  }

  const create = (visit: Visit, serviceId: string, login: Login = vet, id = uuidv7(), lineId = uuidv7()) =>
    practice.request(login, `/invoices/${id}`, {
      method: 'PUT',
      body: { ...visit, line: { id: lineId, serviceId, quantity: 1 } },
    })
  const ifMatch = (version: number) => ({ 'if-match': `"${version}"` })
  const addLine = (invoice: InvoiceBody, serviceId: string, login: Login = vet, lineId = uuidv7(), quantity = 1) =>
    practice.request(login, `/invoices/${invoice.id}/lines/${lineId}`, {
      method: 'PUT',
      headers: ifMatch(invoice.version),
      body: { serviceId, quantity },
    })
  const setQuantity = (invoice: InvoiceBody, lineId: string, quantity: number, login: Login = vet) =>
    practice.request(login, `/invoices/${invoice.id}/lines/${lineId}/quantity`, {
      method: 'PUT',
      headers: ifMatch(invoice.version),
      body: { quantity },
    })
  const remove = (invoice: InvoiceBody, lineId: string, login: Login = vet) =>
    practice.request(login, `/invoices/${invoice.id}/lines/${lineId}/remove`, {
      method: 'POST',
      headers: ifMatch(invoice.version),
    })
  const issue = (invoice: InvoiceBody, login: Login = vet) =>
    practice.request(login, `/invoices/${invoice.id}/issue`, { method: 'POST', headers: ifMatch(invoice.version) })
  const visitInvoice = async (visitId: string, login: Login = vet) =>
    ((await (await practice.request(login, `/visits/${visitId}/invoice`)).json()) as { invoice: InvoiceBody | null })
      .invoice
  const json = async (response: Response) => {
    expect(response.status).toBe(200)
    return (await response.json()) as InvoiceBody
  }

  const charges = async (invoiceId: string) =>
    (
      await migrator.query<{ kind: string; amount_minor: string; client_id: string }>(
        `select kind, amount_minor, client_id from ${schema()}.ledger_entry where invoice_id = $1`,
        [invoiceId],
      )
    ).rows
  const invoiceStatus = async (invoiceId: string) =>
    (await migrator.query<{ status: string }>(`select status from ${schema()}.invoice where id = $1`, [invoiceId]))
      .rows[0]?.status

  it("creates the visit's draft with its first line, the service's three names and its price snapshotted, at the request's location", async () => {
    const visit = await started()
    const id = uuidv7()
    const lineId = uuidv7()

    const invoice = await json(await create(visit, services.consultation, vet, id, lineId))

    expect(invoice).toMatchObject({
      id,
      status: 'draft',
      version: 1,
      number: null,
      visitId: visit.visitId,
      patientId: visit.patientId,
      clientId: visit.clientId,
      currency: 'AZN',
      lines: [
        {
          id: lineId,
          serviceId: services.consultation,
          description: { az: 'Müayinə', ru: 'Осмотр', en: 'Consultation' },
          quantity: 1,
          unitPriceMinor: 2500,
          totalMinor: 2500,
        },
      ],
      totalMinor: 2500,
      paidMinor: 0,
    })
    const stored = await migrator.query(`select location_id, created_by from ${schema()}.invoice where id = $1`, [id])
    expect(stored.rows).toEqual([{ location_id: practice.locationId, created_by: vet.userId }])
    expect(await visitInvoice(visit.visitId)).toMatchObject({ id, lines: [{ id: lineId }] })
  })

  it('a quantity changed and a mistaken line removed while a draft: the total follows, the version moves on, and a stale version is refused with 412', async () => {
    const visit = await started()
    let invoice = await json(await create(visit, services.consultation))
    const vaccineLine = uuidv7()
    invoice = await json(await addLine(invoice, services.vaccination, vet, vaccineLine))
    const consultationLine = invoice.lines[0]?.id as string
    const stale = invoice

    invoice = await json(await setQuantity(invoice, vaccineLine, 2))
    expect(invoice.lines.map((line) => [line.description.en, line.quantity, line.totalMinor])).toEqual([
      ['Consultation', 1, 2500],
      ['Vaccination', 2, 3700],
    ])
    expect(invoice.totalMinor).toBe(6200)
    expect(invoice.version).toBe(stale.version + 1)

    expect((await remove(stale, consultationLine)).status).toBe(412)
    invoice = await json(await remove(invoice, consultationLine))
    expect(invoice.lines.map((line) => line.id)).toEqual([vaccineLine])
    expect(invoice.totalMinor).toBe(3700)
    expect((await remove(invoice, consultationLine)).status).toBe(404)
  })

  it('retries change nothing: the same create and the same line answer as the first did; their ids on another invoice are refused', async () => {
    const visit = await started()
    const id = uuidv7()
    const lineId = uuidv7()
    const first = await json(await create(visit, services.consultation, vet, id, lineId))
    const again = await json(await create(visit, services.consultation, vet, id, lineId))
    expect(again).toEqual(first)

    const added = uuidv7()
    const withLine = await json(await addLine(first, services.vaccination, vet, added))
    expect(await json(await addLine(first, services.vaccination, vet, added))).toEqual(withLine)

    const other = await started()
    expect((await create(other, services.consultation, vet, id)).status).toBe(409)
    const otherInvoice = await json(await create(other, services.consultation))
    expect((await addLine(otherInvoice, services.vaccination, vet, added)).status).toBe(409)
    expect((await create(visit, services.consultation)).status).toBe(409)
  })

  it("refuses a patient or client that is not the visit's, a cancelled visit, and a service not on the price list", async () => {
    const visit = await started()
    const other = await started()

    expect((await create({ ...visit, clientId: other.clientId }, services.consultation)).status).toBe(409)
    expect((await create({ ...visit, patientId: other.patientId }, services.consultation)).status).toBe(409)
    expect((await create({ ...visit, visitId: uuidv7() }, services.consultation)).status).toBe(404)
    expect((await create(visit, uuidv7())).status).toBe(404)
    expect(await visitInvoice(visit.visitId)).toBeNull()
  })

  it('AC-4: Issue invoice takes the next number and writes one charge equal to the live lines; Balance due is the total', async () => {
    const first = await started()
    let invoice = await json(await create(first, services.consultation))
    const mistaken = uuidv7()
    invoice = await json(await addLine(invoice, services.vaccination, vet, uuidv7(), 2))
    invoice = await json(await addLine(invoice, services.consultation, vet, mistaken))
    invoice = await json(await remove(invoice, mistaken))

    const issued = await json(await issue(invoice))

    expect(issued).toMatchObject({ status: 'issued', totalMinor: 6200, paidMinor: 0, remainderMinor: 6200 })
    expect(issued.number).toMatch(/^\d+$/)
    expect(await charges(invoice.id)).toEqual([{ kind: 'charge', amount_minor: '6200', client_id: first.clientId }])

    // The next invoice takes the next number.
    const second = await started()
    const next = await json(await issue(await json(await create(second, services.consultation))))
    expect(Number(next.number)).toBe(Number(issued.number) + 1)
  })

  it('BL-6, AC-4: an issued invoice is frozen: a second issue, a new line, a quantity and a removal are refused as frozen, and the charge stays one', async () => {
    const visit = await started()
    const draft = await json(await create(visit, services.consultation))
    const issued = await json(await issue(draft))
    const line = issued.lines[0]?.id as string

    for (const [what, response] of [
      ['issue', await issue(issued)],
      ['add', await addLine(issued, services.vaccination)],
      ['quantity', await setQuantity(issued, line, 3)],
      ['remove', await remove(issued, line)],
    ] as const) {
      expect(response.status, what).toBe(409)
      expect(await response.json(), what).toMatchObject({ code: 'vetora.frozen_record' })
    }
    expect(await charges(issued.id)).toHaveLength(1)
    expect(await visitInvoice(visit.visitId)).toEqual(issued)
  })

  it('an invoice whose lines were all removed is not issued: refused at commit with vetora.incomplete_invoice, and no number is used', async () => {
    const visit = await started()
    let invoice = await json(await create(visit, services.consultation))
    invoice = await json(await remove(invoice, invoice.lines[0]?.id as string))
    const before = await migrator.query<{ last_value: string }>(`select last_value from ${schema()}.invoice_number_seq`)

    const response = await issue(invoice)

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'vetora.incomplete_invoice' })
    expect(await invoiceStatus(invoice.id)).toBe('draft')
    const after = await migrator.query<{ last_value: string }>(`select last_value from ${schema()}.invoice_number_seq`)
    expect(after.rows).toEqual(before.rows)
  })

  it('Cancel visit discards a draft invoice with the visit; with an issued invoice it is refused and changes nothing', async () => {
    const cancel = (visitId: string) =>
      practice.request(vet, `/visits/${visitId}/cancel`, { method: 'POST', headers: ifMatch(1) })

    const drafted = await started()
    const draft = await json(await create(drafted, services.consultation))
    expect((await cancel(drafted.visitId)).status).toBe(200)
    expect(await invoiceStatus(draft.id)).toBe('discarded')

    const invoiced = await started()
    const issued = await json(await issue(await json(await create(invoiced, services.consultation))))
    const refused = await cancel(invoiced.visitId)
    expect(refused.status).toBe(409)
    expect(refused.headers.get('content-type')).toContain('application/problem+json')
    expect(await invoiceStatus(issued.id)).toBe('issued')
    const visit = await migrator.query<{ status: string; version: number }>(
      `select status, version from ${schema()}.encounter where id = $1`,
      [invoiced.visitId],
    )
    expect(visit.rows).toEqual([{ status: 'draft', version: 1 }])
  })

  it("Visits today shows each visit's invoice: none, then draft, then unpaid once issued", async () => {
    const visit = await started()
    const stateOf = async () => {
      const today = (await (await practice.request(desk, '/visits')).json()) as {
        visits: { id: string; invoice: string }[]
      }
      return today.visits.find((row) => row.id === visit.visitId)?.invoice
    }

    expect(await stateOf()).toBe('none')
    const draft = await json(await create(visit, services.consultation, desk))
    expect(await stateOf()).toBe('draft')
    await json(await issue(draft, desk))
    expect(await stateOf()).toBe('unpaid')
  })

  it('the matrix: a receptionist adds a line and issues; a groomer is refused every invoice route and the price list', async () => {
    const visit = await started()
    let invoice = await json(await create(visit, services.consultation, desk))
    invoice = await json(await addLine(invoice, services.vaccination, desk))
    const line = invoice.lines[1]?.id as string

    for (const [what, response] of [
      ['price list', await practice.request(groomer, '/services')],
      ['read', await practice.request(groomer, `/visits/${visit.visitId}/invoice`)],
      ['create', await create(await started(), services.consultation, groomer)],
      ['add', await addLine(invoice, services.vaccination, groomer)],
      ['quantity', await setQuantity(invoice, line, 2, groomer)],
      ['remove', await remove(invoice, line, groomer)],
      ['issue', await issue(invoice, groomer)],
    ] as const) {
      expect(response.status, what).toBe(403)
    }

    const issued = await json(await issue(invoice, desk))
    expect(issued).toMatchObject({ status: 'issued', totalMinor: 4350 })
  })

  describe('Take payment (#26)', () => {
    type PaymentOptions = { login?: Login; method?: 'cash' | 'card'; paymentId?: string; version?: number }
    const takePayment = (invoice: InvoiceBody, amountMinor: number, options: PaymentOptions = {}) => {
      const { login = desk, method = 'cash', paymentId = uuidv7(), version = invoice.version } = options
      return practice.request(login, `/invoices/${invoice.id}/payments/${paymentId}`, {
        method: 'PUT',
        headers: ifMatch(version),
        body: { amountMinor, method },
      })
    }

    /** A visit's draft invoice of a consultation and a vaccination, 43,50 ₼. */
    async function drafted() {
      const visit = await started()
      const draft = await json(await create(visit, services.consultation))
      return { visit, invoice: await json(await addLine(draft, services.vaccination)) }
    }

    /** The client's payments as the database holds them, each with its allocation and its ledger entry. */
    const paymentsOf = async (clientId: string) =>
      (
        await migrator.query(
          `select p.method, p.amount_minor, p.location_id, p.received_by, a.invoice_id,
                  a.amount_minor as allocated, l.amount_minor as entry
           from ${schema()}.payment p
           join ${schema()}.payment_allocation a on a.payment_id = p.id
           join ${schema()}.ledger_entry l on l.payment_id = p.id
           where p.client_id = $1 order by p.created_at`,
          [clientId],
        )
      ).rows

    /** The owner's balance as the visit page reads it. */
    const ownerBalance = async (visitId: string) =>
      ((await (await practice.request(desk, `/visits/${visitId}`)).json()) as { owner: { balance: unknown } }).owner
        .balance

    /** The visit's invoice as Visits today shows it. */
    const stateOn = async (visitId: string) => {
      const today = (await (await practice.request(desk, '/visits')).json()) as {
        visits: { id: string; invoice: string }[]
      }
      return today.visits.find((row) => row.id === visitId)?.invoice
    }

    it('on a draft invoice it issues it and records the payment, its ledger entry and its allocation in one transaction; a retry with the same payment id changes nothing', async () => {
      const { visit, invoice } = await drafted()
      const paymentId = uuidv7()

      const paid = await json(await takePayment(invoice, 4350, { method: 'card', paymentId }))

      expect(paid).toMatchObject({
        status: 'issued',
        version: invoice.version + 1,
        totalMinor: 4350,
        paidMinor: 4350,
        remainderMinor: 0,
      })
      expect(paid.number).toMatch(/^\d+$/)
      expect(await charges(invoice.id)).toEqual([{ kind: 'charge', amount_minor: '4350', client_id: visit.clientId }])
      const taken = [
        {
          method: 'card',
          amount_minor: '4350',
          location_id: practice.locationId,
          received_by: desk.userId,
          invoice_id: invoice.id,
          allocated: '4350',
          entry: '-4350',
        },
      ]
      expect(await paymentsOf(visit.clientId)).toEqual(taken)

      // The retry carries the version the first request was made against, which the issue moved on.
      expect(await json(await takePayment(invoice, 4350, { method: 'card', paymentId }))).toEqual(paid)
      expect(await paymentsOf(visit.clientId)).toEqual(taken)
      expect(await charges(invoice.id)).toHaveLength(1)

      const other = await drafted()
      expect((await takePayment(other.invoice, 1000, { paymentId })).status).toBe(409)
      expect(await invoiceStatus(other.invoice.id)).toBe('draft')
    })

    it('BL-5, BL-6: a part payment leaves Balance due the total less the payment; a second of the rest brings it to zero and the invoice to paid', async () => {
      const { visit, invoice } = await drafted()
      expect(await ownerBalance(visit.visitId)).toBeNull()
      const issued = await json(await issue(invoice))
      expect(await ownerBalance(visit.visitId)).toEqual({ amountMinor: 4350, currency: 'AZN' })
      expect(await stateOn(visit.visitId)).toBe('unpaid')

      const part = await json(await takePayment(issued, 1000))
      expect(part).toMatchObject({ status: 'issued', version: issued.version, paidMinor: 1000, remainderMinor: 3350 })
      expect(await ownerBalance(visit.visitId)).toEqual({ amountMinor: 3350, currency: 'AZN' })
      expect(await stateOn(visit.visitId)).toBe('partly_paid')

      const rest = await json(await takePayment(part, 3350, { method: 'card', login: vet }))
      expect(rest).toMatchObject({ paidMinor: 4350, remainderMinor: 0 })
      expect(await ownerBalance(visit.visitId)).toEqual({ amountMinor: 0, currency: 'AZN' })
      expect(await stateOn(visit.visitId)).toBe('paid')
      expect((await paymentsOf(visit.clientId)).map((row) => [row.method, row.entry, row.received_by])).toEqual([
        ['cash', '-1000', desk.userId],
        ['card', '-3350', vet.userId],
      ])
    })

    it('a payment of zero or above the remainder answers a problem response naming the amount and writes nothing', async () => {
      const { visit, invoice } = await drafted()

      for (const amount of [0, -100, 12.5]) {
        const refused = await takePayment(invoice, amount)
        expect(refused.status, String(amount)).toBe(400)
        expect(refused.headers.get('content-type')).toBe('application/problem+json')
        expect(await refused.json()).toMatchObject({ errors: [{ path: ['amountMinor'] }] })
      }
      const tooMuch = await takePayment(invoice, 4351)
      expect(tooMuch.status).toBe(409)
      expect(tooMuch.headers.get('content-type')).toBe('application/problem+json')
      expect(await tooMuch.json()).toMatchObject({ errors: [{ path: ['amountMinor'], code: 'above_remainder' }] })
      expect(await invoiceStatus(invoice.id)).toBe('draft')
      expect(await charges(invoice.id)).toEqual([])

      const part = await json(await takePayment(invoice, 4000))
      const aboveRest = await takePayment(part, 351)
      expect(aboveRest.status).toBe(409)
      expect(await aboveRest.json()).toMatchObject({ errors: [{ path: ['amountMinor'], code: 'above_remainder' }] })
      expect(await paymentsOf(visit.clientId)).toHaveLength(1)
    })

    it('a stale version is refused with 412, a discarded invoice with 404, a groomer with 403', async () => {
      const { visit, invoice } = await drafted()
      await json(await setQuantity(invoice, invoice.lines[1]?.id as string, 2))
      expect((await takePayment(invoice, 1000)).status).toBe(412)
      expect((await takePayment(invoice, 1000, { login: groomer, version: invoice.version + 1 })).status).toBe(403)

      const cancelled = await practice.request(vet, `/visits/${visit.visitId}/cancel`, {
        method: 'POST',
        headers: ifMatch(1),
      })
      expect(cancelled.status).toBe(200)
      expect((await takePayment(invoice, 1000, { version: invoice.version + 1 })).status).toBe(404)
      expect(await paymentsOf(visit.clientId)).toEqual([])
    })

    it("a payment's business_date is its day in the practice's time zone: Baku's, and a zone's just past its midnight while UTC is on another day", async () => {
      const { invoice } = await drafted()
      /** A fixed offset zone, whole hours east of UTC, as the tz database names it (its sign the other way round). */
      const offsetZone = (hoursEast: number) =>
        hoursEast === 0 ? 'Etc/UTC' : `Etc/GMT${hoursEast > 0 ? '-' : '+'}${Math.abs(hoursEast)}`
      const dayIn = (zone: string, instant: Date) =>
        new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
          instant,
        )
      // The database's clock cannot be set, so the practice's zone moves instead: from 10:00 UTC a zone ahead of UTC
      // reads 00:xx on the next day; before it, the zone reading 00:xx is on UTC's day, and one twelve hours behind is
      // on the day before. Between 20:00 and 24:00 UTC, Baku itself is just past midnight.
      const hour = new Date().getUTCHours()
      const pastMidnight = offsetZone(hour >= 10 ? 24 - hour : -hour)
      const apart = offsetZone(hour >= 10 ? 24 - hour : -12)

      let current = invoice
      try {
        for (const zone of ['Asia/Baku', pastMidnight, apart]) {
          await migrator.query(`update ${schema()}.practice_settings set time_zone = $1`, [zone])
          const paymentId = uuidv7()
          current = await json(await takePayment(current, 100, { paymentId }))
          const [taken] = (
            await migrator.query<{ occurred_at: Date; business_date: string }>(
              `select occurred_at, business_date::text from ${schema()}.payment where id = $1`,
              [paymentId],
            )
          ).rows
          if (!taken) throw new Error(`no payment in ${zone}`)
          expect(taken.business_date, zone).toBe(dayIn(zone, taken.occurred_at))
          if (zone === apart) expect(taken.business_date, zone).not.toBe(dayIn('Etc/UTC', taken.occurred_at))
        }
      } finally {
        await migrator.query(`update ${schema()}.practice_settings set time_zone = 'Asia/Baku'`)
      }
    })
  })
})
