import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { missingRowOf, ruleOf } from './errors.js'
import { migrate } from './migrator.js'
import {
  asPractice,
  beginAsPractice,
  databaseTestsEnabled,
  PERMISSION_DENIED,
  provisionTestPractice,
  resetTestDatabase,
  type TestDatabaseUrls,
  type TestPractice,
  testDatabaseUrls,
} from './test-support.js'

/**
 * The price list, the invoice of a visit and its payments (#25, #26; spec 0002, "Data model sketch": `service`,
 * `invoice`, `invoice_line`, `ledger_entry`, `payment`, `payment_allocation`, "Value sourcing": Issue an invoice, Add
 * an invoice line, Record a payment, Show a client's balance; AC-4, AC-9), seam 1 of spec #18: what the database
 * itself guarantees, through the practice role as a request writes, whatever the API does. The handler's side (the
 * snapshot it takes, the number and the charge it writes at issue, the payment it takes, what a person sees) is the
 * API seam, src/http/invoices.test.ts (Take payment's cases among them) and src/http/walk.test.ts.
 */

const CHECK_VIOLATION = '23514'
const UNIQUE_VIOLATION = '23505'

describe.skipIf(!databaseTestsEnabled())('the price list, the invoice and the ledger (#25, seam 1)', () => {
  let urls: TestDatabaseUrls
  let migrator: pg.Client
  /** vetora_app on vetora_test: what a request sees. */
  let app: pg.Client
  let practice: TestPractice
  let schema: string
  let locationId: string

  beforeAll(async () => {
    urls = testDatabaseUrls()
    await resetTestDatabase(urls)
    await migrate({ url: urls.migrator })
    migrator = new pg.Client({ connectionString: urls.migrator, application_name: 'billing.test' })
    await migrator.connect()
    await migrator.query("select set_config('app.migration', 'billing.test', false)")
    app = new pg.Client({ connectionString: urls.app, application_name: 'billing.test app' })
    await app.connect()
    practice = await provisionTestPractice(urls)
    schema = pg.escapeIdentifier(practice.schema)
    const here = await migrator.query<{ id: string }>(`select id from ${schema}.location where is_default`)
    locationId = here.rows[0]?.id as string
  }, 30_000)

  afterAll(async () => {
    await practice?.drop()
    await migrator?.end()
    await app?.end()
  })

  /** One request transaction as the practice's manager. */
  const asManager = <T>(run: (client: pg.Client) => Promise<T>) => asPractice(app, practice, run)

  const refusalOf = (work: Promise<unknown>) =>
    work.then(
      () => undefined,
      (error: unknown) => error,
    )

  /** A client who owns a new patient from today; their ids. */
  async function ownedPatient() {
    return asManager(async (client) => {
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

  /** A service on the price list, its price in qəpik; its id. */
  async function priced(price: number, names = { az: 'Müayinə', ru: 'Осмотр', en: 'Consultation' }) {
    const row = await asManager((client) =>
      client.query<{ id: string }>(
        `insert into ${schema}.service (name_az, name_ru, name_en, category, price_minor)
         values ($1, $2, $3, 'consultation', $4) returning id`,
        [names.az, names.ru, names.en, price],
      ),
    )
    return row.rows[0]?.id as string
  }

  /** A draft invoice for a client and patient at the default location; its id. */
  async function draftInvoice(owner: { clientId: string; patientId: string }, encounterId: string | null = null) {
    const row = await asManager((client) =>
      client.query<{ id: string }>(
        `insert into ${schema}.invoice (location_id, client_id, patient_id, encounter_id) values ($1, $2, $3, $4)
         returning id`,
        [locationId, owner.clientId, owner.patientId, encounterId],
      ),
    )
    return row.rows[0]?.id as string
  }

  /** A line as the handler writes it: the service's names and price snapshotted, the total rounded half up. */
  async function addLine(invoiceId: string, serviceId: string, quantity = '1') {
    const row = await asManager((client) =>
      client.query<{ id: string }>(
        `insert into ${schema}.invoice_line
           (invoice_id, kind, service_id, description_az, description_ru, description_en, quantity, unit_price_minor,
            total_minor, sort)
         select $1, 'service', s.id, s.name_az, s.name_ru, s.name_en, $3::numeric, s.price_minor,
                round($3::numeric * s.price_minor),
                coalesce((select max(sort) from ${schema}.invoice_line where invoice_id = $1), 0) + 1
         from ${schema}.service s where s.id = $2
         returning id`,
        [invoiceId, serviceId, quantity],
      ),
    )
    return row.rows[0]?.id as string
  }

  /**
   * The issue as the handler runs it, in one transaction: the invoice locked, the next number and the moment, then the
   * charge entry of `charge` (SQL; the live lines' total unless given); `skipCharge` leaves the entry out.
   */
  const issue = (invoiceId: string, { charge, skipCharge = false }: { charge?: string; skipCharge?: boolean } = {}) =>
    asManager(async (client) => {
      await client.query(`select id from ${schema}.invoice where id = $1 for update`, [invoiceId])
      await client.query(
        `update ${schema}.invoice set status = 'issued', number = ${schema}.next_invoice_number(), issued_at = now()
         where id = $1`,
        [invoiceId],
      )
      if (skipCharge) return
      await client.query(
        `insert into ${schema}.ledger_entry (client_id, kind, amount_minor, invoice_id)
         select client_id, 'charge',
                ${charge ?? `(select coalesce(sum(total_minor), 0) from ${schema}.invoice_line where invoice_id = $1 and removed_at is null)`},
                id
         from ${schema}.invoice where id = $1`,
        [invoiceId],
      )
    })

  const invoiceRow = async (invoiceId: string) =>
    (
      await migrator.query<{ status: string; number: string | null; issued: boolean }>(
        `select status, number, issued_at is not null as issued from ${schema}.invoice where id = $1`,
        [invoiceId],
      )
    ).rows[0]

  const charges = async (invoiceId: string) =>
    (
      await migrator.query<{ kind: string; amount_minor: string; client_id: string }>(
        `select kind, amount_minor, client_id from ${schema}.ledger_entry where invoice_id = $1`,
        [invoiceId],
      )
    ).rows

  it('IN-1: an insert on service, invoice, invoice_line and ledger_entry writes one audit_event row naming the actor', async () => {
    const owner = await ownedPatient()
    const serviceId = await priced(2500)
    const invoiceId = await draftInvoice(owner)
    const lineId = await addLine(invoiceId, serviceId)
    await issue(invoiceId)
    const [entry] = (
      await migrator.query<{ id: string }>(`select id from ${schema}.ledger_entry where invoice_id = $1`, [invoiceId])
    ).rows

    for (const [table, id] of [
      ['service', serviceId],
      ['invoice', invoiceId],
      ['invoice_line', lineId],
      ['ledger_entry', entry?.id],
    ] as const) {
      const rows = await migrator.query(
        `select action, actor_id, source from ${schema}.audit_event
         where table_name = $1 and row_id = $2 and action = 'insert'`,
        [table, id],
      )
      expect(rows.rows, table).toEqual([{ action: 'insert', actor_id: practice.managerId, source: 'request' }])
    }
  })

  it('a line snapshots the service: a later price or name change touches no line, and the snapshot never changes', async () => {
    const owner = await ownedPatient()
    const serviceId = await priced(2500)
    const invoiceId = await draftInvoice(owner)
    const lineId = await addLine(invoiceId, serviceId, '2')

    await asManager((client) =>
      client.query(`update ${schema}.service set price_minor = 3000, name_en = 'Exam' where id = $1`, [serviceId]),
    )
    const line = await migrator.query(
      `select description_az, description_ru, description_en, unit_price_minor, quantity::text, total_minor
       from ${schema}.invoice_line where id = $1`,
      [lineId],
    )
    expect(line.rows).toEqual([
      {
        description_az: 'Müayinə',
        description_ru: 'Осмотр',
        description_en: 'Consultation',
        unit_price_minor: '2500',
        quantity: '2',
        total_minor: '5000',
      },
    ])

    // The practice role holds no UPDATE on a snapshot or a reference (the grant); the trigger holds for the owner too.
    for (const change of [
      'unit_price_minor = 3000, total_minor = 6000',
      "description_en = 'Exam'",
      `service_id = '${await priced(100)}'`,
      'discount_minor = 100, discount_reason = $$Regular client$$, total_minor = 4900',
    ]) {
      const statement = `update ${schema}.invoice_line set ${change} where id = $1`
      expect(await refusalOf(asManager((client) => client.query(statement, [lineId]))), change).toMatchObject(
        PERMISSION_DENIED,
      )
      expect(ruleOf(await refusalOf(migrator.query(statement, [lineId]))), change).toBe('vetora.set_once')
    }
  })

  it("while a draft, a line's quantity changes with its total, its total stays quantity times price rounded half up, and it is removed once", async () => {
    const owner = await ownedPatient()
    const serviceId = await priced(1999)
    const invoiceId = await draftInvoice(owner)
    const lineId = await addLine(invoiceId, serviceId)

    await asManager((client) =>
      client.query(`update ${schema}.invoice_line set quantity = 1.5, total_minor = 2999 where id = $1`, [lineId]),
    )
    const wrongTotal = await refusalOf(
      asManager((client) =>
        client.query(`update ${schema}.invoice_line set quantity = 2, total_minor = 2999 where id = $1`, [lineId]),
      ),
    )
    expect(wrongTotal).toMatchObject({ code: CHECK_VIOLATION, constraint: 'invoice_line_total_check' })
    const noQuantity = await refusalOf(
      asManager((client) =>
        client.query(`update ${schema}.invoice_line set quantity = 0, total_minor = 0 where id = $1`, [lineId]),
      ),
    )
    expect(noQuantity).toMatchObject({ code: CHECK_VIOLATION, constraint: 'invoice_line_quantity_check' })

    await asManager((client) =>
      client.query(`update ${schema}.invoice_line set removed_at = now() where id = $1`, [lineId]),
    )
    const again = await refusalOf(
      asManager((client) =>
        client.query(`update ${schema}.invoice_line set removed_at = now() + interval '1 second' where id = $1`, [
          lineId,
        ]),
      ),
    )
    expect(ruleOf(again)).toBe('vetora.set_once')
    const row = await migrator.query(
      `select quantity::text, total_minor, removed_at is not null as removed from ${schema}.invoice_line where id = $1`,
      [lineId],
    )
    expect(row.rows).toEqual([{ quantity: '1.5', total_minor: '2999', removed: true }])
  })

  it('AC-4: issuing writes the number and one charge entry equal to the live lines, removed lines left out', async () => {
    const owner = await ownedPatient()
    const consultation = await priced(2500)
    const vaccine = await priced(1800, { az: 'Peyvənd', ru: 'Вакцинация', en: 'Vaccination' })
    const invoiceId = await draftInvoice(owner)
    await addLine(invoiceId, consultation)
    await addLine(invoiceId, vaccine, '2')
    const mistaken = await addLine(invoiceId, consultation)
    await asManager((client) =>
      client.query(`update ${schema}.invoice_line set removed_at = now() where id = $1`, [mistaken]),
    )

    await issue(invoiceId)

    expect(await invoiceRow(invoiceId)).toMatchObject({ status: 'issued', issued: true, number: expect.any(String) })
    expect(await charges(invoiceId)).toEqual([{ kind: 'charge', amount_minor: '6100', client_id: owner.clientId }])
  })

  it('AC-4: a commit that issues without its charge entry, or with a wrong one, fails with vetora.incomplete_invoice and keeps nothing', async () => {
    const owner = await ownedPatient()
    const serviceId = await priced(2500)
    const invoiceId = await draftInvoice(owner)
    await addLine(invoiceId, serviceId)

    for (const options of [{ skipCharge: true }, { charge: '2400' }]) {
      const refused = await refusalOf(issue(invoiceId, options))
      expect(ruleOf(refused), JSON.stringify(options)).toBe('vetora.incomplete_invoice')
      expect(missingRowOf(refused)).toBe('ledger_entry')
    }
    const twice = await refusalOf(
      asManager(async (client) => {
        await client.query(
          `update ${schema}.invoice set status = 'issued', number = ${schema}.next_invoice_number(), issued_at = now()
           where id = $1`,
          [invoiceId],
        )
        for (let n = 0; n < 2; n++) {
          await client.query(
            `insert into ${schema}.ledger_entry (client_id, kind, amount_minor, invoice_id) values ($1, 'charge', 2500, $2)`,
            [owner.clientId, invoiceId],
          )
        }
      }),
    )
    expect(missingRowOf(twice)).toBe('ledger_entry')
    expect(await invoiceRow(invoiceId)).toMatchObject({ status: 'draft', number: null, issued: false })
    expect(await charges(invoiceId)).toEqual([])
  })

  it('AC-4: an invoice with no live line is not issued, and a charge on a draft invoice is refused', async () => {
    const owner = await ownedPatient()
    const serviceId = await priced(2500)
    const empty = await draftInvoice(owner)
    const allRemoved = await draftInvoice(owner)
    const lineId = await addLine(allRemoved, serviceId)
    await asManager((client) =>
      client.query(`update ${schema}.invoice_line set removed_at = now() where id = $1`, [lineId]),
    )

    for (const invoiceId of [empty, allRemoved]) {
      const refused = await refusalOf(issue(invoiceId, { charge: '0' }))
      expect(ruleOf(refused)).toBe('vetora.incomplete_invoice')
      expect(missingRowOf(refused)).toBe('invoice_line')
    }
    const draftCharge = await refusalOf(
      asManager((client) =>
        client.query(
          `insert into ${schema}.ledger_entry (client_id, kind, amount_minor, invoice_id) values ($1, 'charge', 2500, $2)`,
          [owner.clientId, empty],
        ),
      ),
    )
    expect(ruleOf(draftCharge)).toBe('vetora.incomplete_invoice')
    expect(missingRowOf(draftCharge)).toBe('invoice')
  })

  it('AC-4, BL-6: after issue the invoice and its lines are frozen, no line is added, and the ledger cannot change', async () => {
    const owner = await ownedPatient()
    const serviceId = await priced(2500)
    const invoiceId = await draftInvoice(owner)
    const lineId = await addLine(invoiceId, serviceId)
    await issue(invoiceId)

    const asManagerRefusal = (sql: string, values: unknown[]) =>
      refusalOf(asManager((client) => client.query(sql, values)))
    for (const [what, sql, values] of [
      ['the invoice', `update ${schema}.invoice set client_id = null where id = $1`, [invoiceId]],
      ['its status', `update ${schema}.invoice set status = 'draft' where id = $1`, [invoiceId]],
      ['a line', `update ${schema}.invoice_line set quantity = 2, total_minor = 5000 where id = $1`, [lineId]],
      ['a removal', `update ${schema}.invoice_line set removed_at = now() where id = $1`, [lineId]],
    ] as const) {
      expect(ruleOf(await asManagerRefusal(sql, [...values])), what).toBe('vetora.frozen_record')
    }
    expect(ruleOf(await refusalOf(addLine(invoiceId, serviceId)))).toBe('vetora.frozen_record')
    for (const sql of [
      `update ${schema}.ledger_entry set amount_minor = 0 where invoice_id = $1`,
      `delete from ${schema}.ledger_entry where invoice_id = $1`,
      `delete from ${schema}.invoice where id = $1`,
    ]) {
      expect(await asManagerRefusal(sql, [invoiceId]), sql).toMatchObject(PERMISSION_DENIED)
    }
    expect(await charges(invoiceId)).toEqual([{ kind: 'charge', amount_minor: '2500', client_id: owner.clientId }])
  })

  it('numbers are consecutive, an issue that fails at commit leaves no gap, and the counter is not the practice role to write', async () => {
    const owner = await ownedPatient()
    const serviceId = await priced(2500)
    const [first, failing, second] = [await draftInvoice(owner), await draftInvoice(owner), await draftInvoice(owner)]
    for (const invoiceId of [first, failing, second]) await addLine(invoiceId, serviceId)

    await issue(first)
    expect(ruleOf(await refusalOf(issue(failing, { skipCharge: true })))).toBe('vetora.incomplete_invoice')
    await issue(second)

    const firstNumber = Number((await invoiceRow(first))?.number)
    expect(Number((await invoiceRow(second))?.number)).toBe(firstNumber + 1)
    expect(await invoiceRow(failing)).toMatchObject({ status: 'draft', number: null })
    expect(
      await refusalOf(asManager((client) => client.query(`update ${schema}.invoice_number_seq set last_value = 0`))),
    ).toMatchObject(PERMISSION_DENIED)
    const withoutActor = await refusalOf(
      asPractice(app, practice, (client) => client.query(`select ${schema}.next_invoice_number()`), { actor: null }),
    )
    expect(ruleOf(withoutActor)).toBe('vetora.no_actor')
  })

  it("AC-4, BL-6: client_balance equals the sum of the client's ledger rows, and leaves out rows without a client", async () => {
    const owner = await ownedPatient()
    const other = await ownedPatient()
    const consultation = await priced(2500)
    const vaccine = await priced(1800, { az: 'Peyvənd', ru: 'Вакцинация', en: 'Vaccination' })
    const first = await draftInvoice(owner)
    await addLine(first, consultation)
    await issue(first)
    const second = await draftInvoice(owner)
    await addLine(second, vaccine, '3')
    await issue(second)
    const others = await draftInvoice(other)
    await addLine(others, consultation)
    await issue(others)
    const anonymous = await asManager((client) =>
      client.query<{ id: string }>(`insert into ${schema}.invoice (location_id) values ($1) returning id`, [
        locationId,
      ]),
    )
    const anonymousId = anonymous.rows[0]?.id as string
    await addLine(anonymousId, consultation)
    await issue(anonymousId)

    const balance = await asManager((client) =>
      client.query(
        `select b.balance_minor, b.currency, (select sum(amount_minor) from ${schema}.ledger_entry where client_id = $1)::text as summed
         from ${schema}.client_balance b where b.client_id = $1`,
        [owner.clientId],
      ),
    )
    expect(balance.rows).toEqual([{ balance_minor: '7900', currency: 'AZN', summed: '7900' }])
    const withoutClient = await asManager((client) =>
      client.query(`select count(*)::int as count from ${schema}.client_balance where client_id is null`),
    )
    expect(withoutClient.rows).toEqual([{ count: 0 }])
  })

  it('one live invoice per visit: a second draft for it is refused until the first is discarded', async () => {
    const owner = await ownedPatient()
    const visit = await asManager((client) =>
      client.query<{ id: string }>(
        `insert into ${schema}.encounter (location_id, patient_id, client_id, veterinarian_id, reported_by_client_id)
         values ($1, $2, $3, $4, $3) returning id`,
        [locationId, owner.patientId, owner.clientId, practice.managerId],
      ),
    )
    const visitId = visit.rows[0]?.id as string
    const first = await draftInvoice(owner, visitId)

    expect(await refusalOf(draftInvoice(owner, visitId))).toMatchObject({
      code: UNIQUE_VIOLATION,
      constraint: 'invoice_encounter_live_idx',
    })
    await asManager((client) =>
      client.query(`update ${schema}.invoice set status = 'discarded' where id = $1`, [first]),
    )
    expect(await draftInvoice(owner, visitId)).toEqual(expect.any(String))
    expect(
      ruleOf(
        await refusalOf(
          asManager((client) => client.query(`update ${schema}.invoice set status = 'draft' where id = $1`, [first])),
        ),
      ),
    ).toBe('vetora.frozen_record')
  })

  describe('payments (#26)', () => {
    /** An issued invoice of a new client: one consultation at 25,00 ₼ and one vaccination at 18,00 ₼, 43,00 ₼ in all. */
    async function issuedInvoice() {
      const owner = await ownedPatient()
      const invoiceId = await draftInvoice(owner)
      await addLine(invoiceId, await priced(2500))
      await addLine(invoiceId, await priced(1800, { az: 'Peyvənd', ru: 'Вакцинация', en: 'Vaccination' }))
      await issue(invoiceId)
      return { ...owner, invoiceId }
    }

    type Companions = {
      /** The ledger entry's amount: the payment's negated unless given; null leaves the entry out. */
      entry?: number | null
      /** The allocation's amount: the payment's unless given; null leaves the allocation out. */
      allocation?: number | null
    }

    /** Write a payment of `amount` against an invoice with its two companions, as the handler does after its lock. */
    async function writePayment(client: pg.Client, invoiceId: string, amount: number, companions: Companions = {}) {
      const { entry = -amount, allocation = amount } = companions
      const paid = await client.query<{ id: string; client_id: string | null }>(
        `insert into ${schema}.payment (location_id, client_id, method, amount_minor, business_date, received_by)
         select $2, client_id, 'cash', $3, current_date, $4 from ${schema}.invoice where id = $1
         returning id, client_id`,
        [invoiceId, locationId, amount, practice.managerId],
      )
      const row = paid.rows[0] as { id: string; client_id: string | null }
      if (entry !== null) {
        await client.query(
          `insert into ${schema}.ledger_entry (client_id, kind, amount_minor, payment_id) values ($1, 'payment', $2, $3)`,
          [row.client_id, entry, row.id],
        )
      }
      if (allocation !== null) {
        await client.query(
          `insert into ${schema}.payment_allocation (payment_id, invoice_id, amount_minor) values ($1, $2, $3)`,
          [row.id, invoiceId, allocation],
        )
      }
      return row.id
    }

    /** Take payment as one request transaction: the invoice locked, then the payment and its companions. */
    const pay = (invoiceId: string, amount: number, companions?: Companions) =>
      asManager(async (client) => {
        await client.query(`select id from ${schema}.invoice where id = $1 for update`, [invoiceId])
        return writePayment(client, invoiceId, amount, companions)
      })

    const balanceOf = async (clientId: string) =>
      (
        await migrator.query<{ balance_minor: string }>(
          `select balance_minor from ${schema}.client_balance where client_id = $1`,
          [clientId],
        )
      ).rows[0]?.balance_minor

    const paymentsOf = async (clientId: string) =>
      (
        await migrator.query<{ count: number }>(
          `select (select count(*)::int from ${schema}.payment where client_id = $1)
                + (select count(*)::int from ${schema}.ledger_entry where client_id = $1 and kind = 'payment') as count`,
          [clientId],
        )
      ).rows[0]?.count

    it('IN-1: an insert on payment and payment_allocation writes one audit_event row naming the actor', async () => {
      const { invoiceId } = await issuedInvoice()
      const paymentId = await pay(invoiceId, 1000)
      const allocation = await migrator.query<{ id: string }>(
        `select id from ${schema}.payment_allocation where payment_id = $1`,
        [paymentId],
      )

      for (const [table, id] of [
        ['payment', paymentId],
        ['payment_allocation', allocation.rows[0]?.id],
      ] as const) {
        const rows = await migrator.query(
          `select action, actor_id, source from ${schema}.audit_event
           where table_name = $1 and row_id = $2 and action = 'insert'`,
          [table, id],
        )
        expect(rows.rows, table).toEqual([{ action: 'insert', actor_id: practice.managerId, source: 'request' }])
      }
    })

    it('AC-4, BL-5, BL-6: a part payment leaves client_balance the charge less the payment, and a second of the rest brings it to zero', async () => {
      const { clientId, invoiceId } = await issuedInvoice()
      expect(await balanceOf(clientId)).toBe('4300')

      await pay(invoiceId, 1000)
      expect(await balanceOf(clientId)).toBe('3300')
      await pay(invoiceId, 3300)
      expect(await balanceOf(clientId)).toBe('0')

      const ledger = await migrator.query(
        `select kind, amount_minor from ${schema}.ledger_entry where client_id = $1 order by amount_minor desc`,
        [clientId],
      )
      expect(ledger.rows).toEqual([
        { kind: 'charge', amount_minor: '4300' },
        { kind: 'payment', amount_minor: '-1000' },
        { kind: 'payment', amount_minor: '-3300' },
      ])
      const allocated = await migrator.query(
        `select sum(amount_minor)::text as sum from ${schema}.payment_allocation where invoice_id = $1`,
        [invoiceId],
      )
      expect(allocated.rows).toEqual([{ sum: '4300' }])
    })

    it('AC-4: a payment committed without its ledger entry, or with a wrong one, fails with vetora.incomplete_payment and keeps nothing', async () => {
      const { clientId, invoiceId } = await issuedInvoice()

      for (const companions of [{ entry: null }, { entry: -999 }, { entry: 1000 }]) {
        const refused = await refusalOf(pay(invoiceId, 1000, companions))
        expect(ruleOf(refused), JSON.stringify(companions)).toBe('vetora.incomplete_payment')
        expect(missingRowOf(refused)).toBe('ledger_entry')
      }
      expect(await paymentsOf(clientId)).toBe(0)
      expect(await balanceOf(clientId)).toBe('4300')

      const twice = await refusalOf(
        asManager(async (client) => {
          const paymentId = await writePayment(client, invoiceId, 1000)
          await client.query(
            `insert into ${schema}.ledger_entry (client_id, kind, amount_minor, payment_id) values ($1, 'payment', -1000, $2)`,
            [clientId, paymentId],
          )
        }),
      )
      expect(twice).toMatchObject({ code: UNIQUE_VIOLATION, constraint: 'ledger_entry_payment_idx' })
      const unnamed = await refusalOf(
        asManager((client) =>
          client.query(
            `insert into ${schema}.ledger_entry (client_id, kind, amount_minor) values ($1, 'payment', -1000)`,
            [clientId],
          ),
        ),
      )
      expect(unnamed).toMatchObject({ code: CHECK_VIOLATION, constraint: 'ledger_entry_payment_check' })
      expect(await paymentsOf(clientId)).toBe(0)
    })

    it('AC-4: an allocation above the invoice total, above its payment, or to a draft invoice fails at commit with vetora.incomplete_allocation and keeps nothing', async () => {
      const { clientId, patientId, invoiceId } = await issuedInvoice()

      const aboveTotal = await refusalOf(pay(invoiceId, 4301))
      expect(ruleOf(aboveTotal)).toBe('vetora.incomplete_allocation')
      expect(missingRowOf(aboveTotal)).toBe('invoice')
      const abovePayment = await refusalOf(pay(invoiceId, 1000, { allocation: 1500 }))
      expect(ruleOf(abovePayment)).toBe('vetora.incomplete_allocation')
      expect(missingRowOf(abovePayment)).toBe('payment')
      const negative = await refusalOf(pay(invoiceId, 1000, { allocation: -1000 }))
      expect(missingRowOf(negative)).toBe('invoice')
      expect(await paymentsOf(clientId)).toBe(0)

      await pay(invoiceId, 3000)
      const aboveRemainder = await refusalOf(pay(invoiceId, 1301))
      expect(ruleOf(aboveRemainder)).toBe('vetora.incomplete_allocation')
      expect(missingRowOf(aboveRemainder)).toBe('invoice')

      const draft = await draftInvoice({ clientId, patientId })
      await addLine(draft, await priced(2500))
      const onDraft = await refusalOf(pay(draft, 1000))
      expect(ruleOf(onDraft)).toBe('vetora.incomplete_allocation')
      expect(missingRowOf(onDraft)).toBe('invoice')
      expect(await paymentsOf(clientId)).toBe(2)
      expect(await balanceOf(clientId)).toBe('1300')
    })

    it("AC-4: an allocation to another client's invoice fails at commit", async () => {
      const { invoiceId } = await issuedInvoice()
      const other = await issuedInvoice()

      const refused = await refusalOf(
        asManager(async (client) => {
          const paymentId = await writePayment(client, invoiceId, 1000, { allocation: null })
          await client.query(
            `insert into ${schema}.payment_allocation (payment_id, invoice_id, amount_minor) values ($1, $2, 1000)`,
            [paymentId, other.invoiceId],
          )
        }),
      )
      expect(ruleOf(refused)).toBe('vetora.incomplete_allocation')
      expect(missingRowOf(refused)).toBe('invoice')
    })

    it('AC-9: an UPDATE or DELETE on a payment or an allocation through the practice role is denied', async () => {
      const { invoiceId } = await issuedInvoice()
      const paymentId = await pay(invoiceId, 1000)

      for (const sql of [
        `update ${schema}.payment set amount_minor = 1 where id = $1`,
        `delete from ${schema}.payment where id = $1`,
        `update ${schema}.payment_allocation set amount_minor = 1 where payment_id = $1`,
        `delete from ${schema}.payment_allocation where payment_id = $1`,
      ]) {
        expect(await refusalOf(asManager((client) => client.query(sql, [paymentId]))), sql).toMatchObject(
          PERMISSION_DENIED,
        )
      }
    })

    it('two payments committing at once cannot both take the remainder: the second waits for the first, then is refused', async () => {
      const { clientId, invoiceId } = await issuedInvoice()
      const other = new pg.Client({ connectionString: urls.app, application_name: 'billing.test other' })
      await other.connect()
      try {
        // The first holds the invoice as its commit check does, its payment written and not yet committed.
        await beginAsPractice(other, practice)
        await other.query(`select id from ${schema}.invoice where id = $1 for no key update`, [invoiceId])
        await writePayment(other, invoiceId, 3000)

        const pid = (await app.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid as number
        const second = refusalOf(asManager((client) => writePayment(client, invoiceId, 3000)))
        await untilBlocked(pid)
        await other.query('commit')

        const refused = await second
        expect(ruleOf(refused)).toBe('vetora.incomplete_allocation')
        expect(missingRowOf(refused)).toBe('invoice')
        expect(await balanceOf(clientId)).toBe('1300')
      } finally {
        await other.end()
      }
    })

    /** Wait until the session `pid` is blocked on a lock another session holds (five seconds at most). */
    async function untilBlocked(pid: number): Promise<void> {
      for (let attempt = 0; attempt < 200; attempt++) {
        const result = await migrator.query<{ blocked: boolean }>(
          'select cardinality(pg_blocking_pids($1)) > 0 as blocked',
          [pid],
        )
        if (result.rows[0]?.blocked) return
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      throw new Error(`session ${pid} never blocked on a lock`)
    }
  })
})
