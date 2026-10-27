import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Invoice, Services, Visit } from '@vetora/contracts'
import { type Language, languages } from '@vetora/i18n'
import { dismissToast } from '@vetora/ui'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { setLanguage } from '../i18n'
import { axeOptions, meOf, problemAnswer, renderApp, stubApi, violationsOf } from '../test-support'

const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', mock)
  return mock
})

/** What the money format puts between an amount and its currency (formats.md, Money). */
const NBSP = ' '
const me = meOf()
const practicePath = `/api/p/${me.practice.id}`
const visitId = '019a3f00-0000-7000-8000-0000000000f1'
const visitPath = `${practicePath}/visits/${visitId}`

/** A draft visit of Şəkər, owned by Aysel, started by Leyla at 09:05 in Baku. */
const visit: Visit = {
  id: visitId,
  status: 'draft',
  version: 1,
  startedAt: '2026-10-27T05:05:00.000Z',
  finalisedAt: null,
  veterinarian: { id: me.id, displayName: 'Leyla Həsənova' },
  patient: {
    id: '019a3f00-0000-7000-8000-0000000000e1',
    name: 'Şəkər',
    species: { az: 'Pişik', ru: 'Кошка', en: 'Cat' },
    breed: null,
    sex: 'female',
    isNeutered: true,
    birthDate: '2022-03-01',
    birthDateIsEstimate: false,
  },
  owner: {
    id: '019a3f00-0000-7000-8000-00000000c1e1',
    firstName: 'Aysel',
    lastName: 'Məmmədova',
    patronymic: null,
    phone: null,
  },
  note: { reasonForVisit: '', anamnesis: '', examination: '', diagnosis: '', treatment: '', recommendations: '' },
}

/** The price list: a consultation at 25,00 ₼ and a vaccination at 18,50 ₼, in minor units. */
const services: Services['services'] = [
  {
    id: '019a3f00-0000-7000-8000-0000000005e1',
    names: { az: 'Müayinə', ru: 'Осмотр', en: 'Consultation' },
    category: 'consultation',
    priceMinor: 2500,
    currency: 'AZN',
  },
  {
    id: '019a3f00-0000-7000-8000-0000000005e2',
    names: { az: 'Peyvənd', ru: 'Вакцинация', en: 'Vaccination' },
    category: 'procedure',
    priceMinor: 1850,
    currency: 'AZN',
  },
]

/** The card's words in each language (the design system glossary and messages, through packages/i18n). */
const words = {
  az: {
    invoice: 'Hesab-faktura',
    numbered: 'Hesab-faktura № 41',
    draft: 'Qaralama',
    unpaid: 'Ödənilməyib',
    addService: 'Xidmət əlavə et',
    issue: 'Hesab-fakturanı rəsmiləşdir',
    issued: 'Hesab-faktura rəsmiləşdirildi',
    empty: 'Hələ xidmət əlavə edilməyib',
    columns: ['Xidmət', 'Miqdar', 'Qiymət, ₼', 'Məbləğ, ₼'],
    quantity: 'Miqdar',
    remove: 'Çıxar',
    total: 'Cəmi',
    balanceDue: 'Borc',
    search: ['müa', 'peyv'],
    names: ['Müayinə', 'Peyvənd'],
    prices: [`25,00${NBSP}₼`, `18,50${NBSP}₼`],
    money: (amount: string) => `${amount}${NBSP}₼`,
    cell: (amount: string) => amount.replace('.', ','),
    cancel: 'Qəbulu ləğv et',
    cancelRefused: 'Qəbulu ləğv etmək mümkün olmadı',
  },
  ru: {
    invoice: 'Счёт',
    numbered: 'Счёт № 41',
    draft: 'Черновик',
    unpaid: 'Не оплачен',
    addService: 'Добавить услугу',
    issue: 'Выставить счёт',
    issued: 'Счёт выставлен',
    empty: 'Услуги ещё не добавлены',
    columns: ['Услуга', 'Количество', 'Цена, ₼', 'Сумма, ₼'],
    quantity: 'Количество',
    remove: 'Убрать',
    total: 'Итого',
    balanceDue: 'Долг',
    search: ['осм', 'вакц'],
    names: ['Осмотр', 'Вакцинация'],
    prices: [`25,00${NBSP}₼`, `18,50${NBSP}₼`],
    money: (amount: string) => `${amount}${NBSP}₼`,
    cell: (amount: string) => amount.replace('.', ','),
    cancel: 'Отменить приём',
    cancelRefused: 'Не удалось отменить приём',
  },
  en: {
    invoice: 'Invoice',
    numbered: 'Invoice No. 41',
    draft: 'Draft',
    unpaid: 'Unpaid',
    addService: 'Add a service',
    issue: 'Issue invoice',
    issued: 'Invoice issued',
    empty: 'No services added yet',
    columns: ['Service', 'Quantity', 'Price, AZN', 'Amount, AZN'],
    quantity: 'Quantity',
    remove: 'Remove',
    total: 'Total',
    balanceDue: 'Balance due',
    search: ['cons', 'vacc'],
    names: ['Consultation', 'Vaccination'],
    prices: [`AZN${NBSP}25.00`, `AZN${NBSP}18.50`],
    money: (amount: string) => `AZN${NBSP}${amount}`,
    cell: (amount: string) => amount,
    cancel: 'Cancel visit',
    cancelRefused: 'The visit could not be cancelled',
  },
} as const satisfies Record<Language, unknown>

/**
 * A fake of the invoice routes, enough to answer the card as the API would: the draft created with its line, lines
 * added, a quantity set, a line removed and the invoice issued, each against the version in If-Match (412 when stale)
 * and each answering the invoice as it then stands. Its totals are the API's sums, worked out here from the lines.
 */
function stubInvoiceApi(initial: Invoice | null = null, who = me) {
  const server = { invoice: initial, stale: false, cancel: () => Response.json({ version: 2 }) as Response }
  const priceOf = (serviceId: string) => services.find((service) => service.id === serviceId)
  const answer = () => {
    const invoice = server.invoice as Invoice
    const totalMinor = invoice.lines.reduce((sum, line) => sum + line.totalMinor, 0)
    invoice.totalMinor = totalMinor
    invoice.remainderMinor = totalMinor
    return Response.json(invoice, { headers: { etag: `"${invoice.version}"` } })
  }
  const lineOf = (id: string, serviceId: string, quantity: number) => {
    const service = priceOf(serviceId)
    if (!service) throw new Error('no such service')
    return {
      id,
      serviceId,
      description: service.names,
      quantity,
      unitPriceMinor: service.priceMinor,
      totalMinor: Math.round(quantity * service.priceMinor),
    }
  }
  stubApi(fetchMock, {
    'GET /api/me': () => Response.json(who),
    [`GET ${practicePath}/visits`]: () => Response.json({ day: '2026-10-27', visits: [] }),
    [`GET ${visitPath}`]: () => Response.json(visit),
    [`GET ${visitPath}/observations`]: () => Response.json({ observations: [] }),
    [`GET ${practicePath}/patients/${visit.patient.id}/last-weight`]: () => Response.json({ lastWeight: null }),
    [`GET ${visitPath}/invoice`]: () => Response.json({ invoice: server.invoice }),
    [`GET ${practicePath}/services`]: () => Response.json({ services }),
    [`POST ${visitPath}/cancel`]: () => server.cancel(),
  })
  const routed = fetchMock.getMockImplementation()
  if (!routed) throw new Error('stubApi answers through the mock implementation')
  const asked: { method: string; path: string; ifMatch: string | null; body: unknown }[] = []
  fetchMock.mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : new Request(String(input), init)
    const path = new URL(request.url).pathname
    if (!path.startsWith(`${practicePath}/invoices/`)) return routed(input, init)
    const text = await request.text()
    const body = (text ? JSON.parse(text) : undefined) as Record<string, unknown> | undefined
    const ifMatch = request.headers.get('if-match')
    asked.push({ method: request.method, path, ifMatch, body })
    const [invoiceId, , lineId, verb] = path.slice(`${practicePath}/invoices/`.length).split('/')
    if (!server.invoice) {
      const line = body?.line as { id: string; serviceId: string; quantity: number }
      server.invoice = {
        id: invoiceId as string,
        status: 'draft',
        version: 1,
        number: null,
        issuedAt: null,
        visitId: body?.visitId as string,
        patientId: body?.patientId as string,
        clientId: body?.clientId as string,
        currency: 'AZN',
        lines: [lineOf(line.id, line.serviceId, line.quantity)],
        totalMinor: 0,
        paidMinor: 0,
        remainderMinor: 0,
      }
      return answer()
    }
    const invoice = server.invoice
    if (server.stale || ifMatch !== `"${invoice.version}"`)
      return problemAnswer(412, 'The invoice changed since it was read')
    invoice.version += 1
    if (path.endsWith('/issue')) {
      invoice.status = 'issued'
      invoice.number = '41'
      invoice.issuedAt = '2026-10-27T05:40:00.000Z'
    } else if (verb === 'quantity') {
      const line = invoice.lines.find((item) => item.id === lineId)
      if (line) Object.assign(line, lineOf(line.id, line.serviceId as string, body?.quantity as number))
    } else if (verb === 'remove') {
      invoice.lines = invoice.lines.filter((item) => item.id !== lineId)
    } else {
      invoice.lines.push(lineOf(lineId as string, body?.serviceId as string, body?.quantity as number))
    }
    return answer()
  })
  return { server, asked }
}

/** The card, once it has loaded: the region its title names, holding the table (the loading card has none). */
const card = (title: string) =>
  waitFor(() => {
    const region = screen.getByRole('region', { name: title })
    within(region).getByRole('table')
    return region
  })

/** The table's lines as a person reads them: name, quantity as typed, price and amount. */
function linesOf(region: HTMLElement) {
  const table = within(region).getByRole('table')
  return within(table)
    .getAllByRole('row')
    .filter((row) => row.parentElement?.tagName === 'TBODY')
    .map((row) => [
      within(row).getByRole('rowheader').textContent,
      ...within(row)
        .getAllByRole('cell')
        .slice(0, 3)
        .map((cell) => cell.querySelector('input')?.value ?? cell.textContent),
    ])
}

/** The totals under the lines: label and amount. */
function totalsOf(region: HTMLElement) {
  const foot = within(region).getByRole('table').querySelector('tfoot') as HTMLElement
  return within(foot)
    .getAllByRole('row')
    .map((row) => [within(row).getByRole('rowheader').textContent, within(row).getAllByRole('cell')[0]?.textContent])
}

describe('the invoice card on the visit page (#25, seam 3)', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    localStorage.clear()
    setLanguage('az')
    dismissToast()
  })

  it.each(languages)(
    'in %s: a service added from the search, a quantity changed, a line removed, then Issue invoice: Total and Balance due from minor units; axe finds no violation',
    async (language) => {
      const { asked } = stubInvoiceApi(null, meOf({ language }))
      setLanguage(language)
      const user = userEvent.setup()
      renderApp(`/visits/${visitId}`)
      const expected = words[language]

      let region = await card(expected.invoice)
      expect(within(region).getByText(expected.empty)).toBeInTheDocument()
      expect(within(region).queryByRole('button', { name: expected.issue })).toBeNull()

      // The search offers the price list by name in the person's language, each with its price.
      const search = within(region).getByRole('combobox', { name: expected.addService })
      await user.type(search, expected.search[0])
      const option = await screen.findByRole('option', { name: new RegExp(expected.names[0]) })
      // textContent as written: toHaveTextContent folds the non-breaking space into a plain one.
      expect(option.textContent).toContain(expected.prices[0])
      await user.click(option)
      await waitFor(() => expect(linesOf(region)).toHaveLength(1))
      expect(search).toHaveValue('')
      await user.type(search, expected.search[1])
      await user.click(await screen.findByRole('option', { name: new RegExp(expected.names[1]) }))
      await waitFor(() => expect(linesOf(region)).toHaveLength(2))

      expect(within(region).getByText(expected.draft)).toBeInTheDocument()
      expect(
        within(within(region).getByRole('table'))
          .getAllByRole('columnheader')
          .map((cell) => cell.textContent)
          .filter(Boolean),
      ).toEqual(expected.columns)
      expect(linesOf(region)).toEqual([
        [expected.names[0], '1', expected.cell('25.00'), expected.cell('25.00')],
        [expected.names[1], '1', expected.cell('18.50'), expected.cell('18.50')],
      ])
      expect(totalsOf(region)).toEqual([[expected.total, expected.money(expected.cell('43.50'))]])

      // Two of the vaccination, then the consultation removed.
      const quantity = within(region).getByRole('textbox', { name: `${expected.quantity}: ${expected.names[1]}` })
      await user.clear(quantity)
      await user.type(quantity, '2{Enter}')
      await waitFor(() => expect(totalsOf(region)).toEqual([[expected.total, expected.money(expected.cell('62.00'))]]))
      await user.click(within(region).getByRole('button', { name: `${expected.remove}: ${expected.names[0]}` }))
      await waitFor(() => expect(linesOf(region)).toHaveLength(1))
      expect(linesOf(region)).toEqual([[expected.names[1], '2', expected.cell('18.50'), expected.cell('37.00')]])
      expect(violationsOf(await axe(document.body, axeOptions))).toEqual([])

      await user.click(within(region).getByRole('button', { name: expected.issue }))

      region = await card(expected.numbered)
      expect(await screen.findByText(expected.issued)).toBeInTheDocument()
      expect(within(region).getByText(expected.unpaid)).toBeInTheDocument()
      expect(totalsOf(region)).toEqual([
        [expected.total, expected.money(expected.cell('37.00'))],
        [expected.balanceDue, expected.money(expected.cell('37.00'))],
      ])
      // Issued, the invoice is read only: no search, no quantity field, no remove, no Issue invoice.
      expect(within(region).queryByRole('combobox')).toBeNull()
      expect(within(region).queryByRole('textbox')).toBeNull()
      expect(within(region).queryByRole('button')).toBeNull()
      // Each change was made against the version the one before it answered.
      expect(asked.map((request) => [request.method, request.ifMatch])).toEqual([
        ['PUT', null],
        ['PUT', '"1"'],
        ['PUT', '"2"'],
        ['POST', '"3"'],
        ['POST', '"4"'],
      ])
      expect(violationsOf(await axe(document.body, axeOptions))).toEqual([])
    },
  )

  it("creates the draft with the visit's patient and owner, and choosing a service already on it raises its quantity", async () => {
    const { asked } = stubInvoiceApi()
    const user = userEvent.setup()
    renderApp(`/visits/${visitId}`)
    const region = await card('Hesab-faktura')
    const search = within(region).getByRole('combobox', { name: 'Xidmət əlavə et' })

    for (let n = 0; n < 2; n++) {
      await user.type(search, 'müa')
      await user.click(await screen.findByRole('option', { name: /Müayinə/ }))
      await waitFor(() => expect(asked).toHaveLength(n + 1))
    }

    expect(asked[0]?.body).toMatchObject({
      visitId,
      patientId: visit.patient.id,
      clientId: visit.owner.id,
      line: { serviceId: services[0]?.id, quantity: 1 },
    })
    expect(asked[1]?.path).toMatch(/\/quantity$/)
    await waitFor(() => expect(linesOf(region)).toEqual([['Müayinə', '2', '25,00', '50,00']]))
  })

  it('the search finds a service by any of its three names, shown by the name in the person’s language', async () => {
    stubInvoiceApi()
    const user = userEvent.setup()
    renderApp(`/visits/${visitId}`)
    const region = await card('Hesab-faktura')
    const search = within(region).getByRole('combobox', { name: 'Xidmət əlavə et' })

    for (const typed of ['вакц', 'vacc', 'peyv']) {
      await user.clear(search)
      await user.type(search, typed)
      const found = await screen.findAllByRole('option')
      expect(found, typed).toHaveLength(1)
      // The name in the person's language first, then the price and the other two names.
      expect(found[0], typed).toHaveTextContent(/^Peyvənd18,50 ₼ · Вакцинация · Vaccination$/)
    }
  })

  it('a change a colleague beat says so, and Refresh shows the invoice as it now stands', async () => {
    const { server } = stubInvoiceApi({
      id: '019a3f00-0000-7000-8000-0000000001a1',
      status: 'draft',
      version: 3,
      number: null,
      issuedAt: null,
      visitId,
      patientId: visit.patient.id,
      clientId: visit.owner.id,
      currency: 'AZN',
      lines: [
        {
          id: '019a3f00-0000-7000-8000-0000000001b1',
          serviceId: services[0]?.id as string,
          description: services[0]?.names as Invoice['lines'][number]['description'],
          quantity: 1,
          unitPriceMinor: 2500,
          totalMinor: 2500,
        },
      ],
      totalMinor: 2500,
      paidMinor: 0,
      remainderMinor: 2500,
    })
    server.stale = true
    const user = userEvent.setup()
    renderApp(`/visits/${visitId}`)
    const region = await card('Hesab-faktura')

    await user.click(within(region).getByRole('button', { name: 'Çıxar: Müayinə' }))

    expect(await within(region).findByText('Siz redaktə edərkən başqa əməkdaş dəyişiklik edib')).toBeInTheDocument()
    expect(linesOf(region)).toHaveLength(1)
    server.stale = false
    await user.click(within(region).getByRole('button', { name: 'Yenilə' }))
    await waitFor(() =>
      expect(within(region).queryByText('Siz redaktə edərkən başqa əməkdaş dəyişiklik edib')).toBeNull(),
    )
  })

  it('Cancel visit with an issued invoice is refused, and the page says so and stays', async () => {
    const { server } = stubInvoiceApi()
    server.cancel = () => problemAnswer(409, "The visit's invoice is issued")
    const user = userEvent.setup()
    const { router } = renderApp(`/visits/${visitId}`)
    await card('Hesab-faktura')

    await user.click(await screen.findByRole('button', { name: words.az.cancel }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: words.az.cancel }))

    expect(await screen.findByText(words.az.cancelRefused)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/visits/${visitId}`)
  })
})
