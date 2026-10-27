import { getDefaultNormalizer, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Invoice, Visit } from '@vetora/contracts'
import { type Language, languages } from '@vetora/i18n'
import { dismissToast } from '@vetora/ui'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { setLanguage } from '../i18n'
import { axeOptions, meOf, renderApp, stubApi, violationsOf } from '../test-support'

const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', mock)
  return mock
})

/** What the money format puts between an amount and its currency, and between thousands (formats.md, Money). */
const NBSP = ' '
const me = meOf()
const practicePath = `/api/p/${me.practice.id}`
const visitId = '019a3f00-0000-7000-8000-0000000000f1'
const visitPath = `${practicePath}/visits/${visitId}`
const invoiceId = '019a3f00-0000-7000-8000-0000000001a1'
const paymentsPath = `${practicePath}/invoices/${invoiceId}/payments/`

/** A visit of Şəkər, owned by Aysel, who owes `owedMinor` across visits; completed unless it is a draft. */
function visitOf(status: Visit['status'], owedMinor: number | null): Visit {
  return {
    id: visitId,
    status,
    version: status === 'draft' ? 1 : 3,
    startedAt: '2026-10-27T05:05:00.000Z',
    finalisedAt: status === 'draft' ? null : '2026-10-27T05:35:00.000Z',
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
      phone: '050 123 45 67',
      balance: owedMinor === null ? null : { amountMinor: owedMinor, currency: 'AZN' },
    },
    note: {
      reasonForVisit: 'Yearly vaccination',
      anamnesis: '',
      examination: '',
      diagnosis: '',
      treatment: '',
      recommendations: '',
    },
  }
}

/** The visit's invoice of a consultation at 25,00 ₼ and a vaccination at 18,50 ₼, 43,50 ₼, with `paidMinor` paid. */
function invoiceOf(status: Invoice['status'], paidMinor = 0): Invoice {
  return {
    id: invoiceId,
    status,
    version: status === 'draft' ? 3 : 4,
    number: status === 'draft' ? null : '41',
    issuedAt: status === 'draft' ? null : '2026-10-27T05:40:00.000Z',
    visitId,
    patientId: '019a3f00-0000-7000-8000-0000000000e1',
    clientId: '019a3f00-0000-7000-8000-00000000c1e1',
    currency: 'AZN',
    lines: [
      {
        id: '019a3f00-0000-7000-8000-0000000001b1',
        serviceId: '019a3f00-0000-7000-8000-0000000005e1',
        description: { az: 'Müayinə', ru: 'Осмотр', en: 'Consultation' },
        quantity: 1,
        unitPriceMinor: 2500,
        totalMinor: 2500,
      },
      {
        id: '019a3f00-0000-7000-8000-0000000001b2',
        serviceId: '019a3f00-0000-7000-8000-0000000005e2',
        description: { az: 'Peyvənd', ru: 'Вакцинация', en: 'Vaccination' },
        quantity: 1,
        unitPriceMinor: 1850,
        totalMinor: 1850,
      },
    ],
    totalMinor: 4350,
    paidMinor,
    remainderMinor: 4350 - paidMinor,
  }
}

/** The page's and the dialog's words in each language (the design system glossary and messages, through packages/i18n). */
const words = {
  az: {
    take: 'Ödəniş qəbul et',
    record: 'Ödənişi qeydə al',
    amount: 'Məbləğ, ₼',
    method: 'Ödəniş üsulu',
    cash: 'Nağd',
    card: 'Kart',
    recorded: 'Ödəniş qeydə alındı',
    invoice: 'Hesab-faktura № 41',
    partlyPaid: 'Qismən ödənilib',
    paid: 'Ödənilib',
    complete: 'Qəbulu tamamla',
    cancel: 'Qəbulu ləğv et',
    typed: (amount: string) => amount.replace('.', ','),
    owes: (amount: string) => `Borc: ${amount.replace('.', ',')}${NBSP}₼`,
    positive: '0-dan böyük məbləğ daxil edin',
    max: (amount: string) => `Borcdan çox olmayan məbləğ daxil edin: ${amount.replace('.', ',')}${NBSP}₼`,
    format: 'Məbləği manatla daxil edin, məsələn 25,50',
  },
  ru: {
    take: 'Принять оплату',
    record: 'Провести оплату',
    amount: 'Сумма, ₼',
    method: 'Способ оплаты',
    cash: 'Наличные',
    card: 'Карта',
    recorded: 'Оплата принята',
    invoice: 'Счёт № 41',
    partlyPaid: 'Оплачен частично',
    paid: 'Оплачен',
    complete: 'Завершить приём',
    cancel: 'Отменить приём',
    typed: (amount: string) => amount.replace('.', ','),
    owes: (amount: string) => `Долг: ${amount.replace('.', ',')}${NBSP}₼`,
    positive: 'Введите сумму больше 0',
    max: (amount: string) => `Введите сумму не больше долга: ${amount.replace('.', ',')}${NBSP}₼`,
    format: 'Введите сумму в манатах, например 25,50',
  },
  en: {
    take: 'Take payment',
    record: 'Record payment',
    amount: 'Amount, AZN',
    method: 'Payment method',
    cash: 'Cash',
    card: 'Card',
    recorded: 'Payment recorded',
    invoice: 'Invoice No. 41',
    partlyPaid: 'Partly paid',
    paid: 'Paid',
    complete: 'Complete visit',
    cancel: 'Cancel visit',
    typed: (amount: string) => amount,
    owes: (amount: string) => `Balance due: AZN${NBSP}${amount}`,
    positive: 'Enter an amount greater than 0',
    max: (amount: string) => `Enter no more than the balance due: AZN${NBSP}${amount}`,
    format: 'Enter the amount in manat, such as 25.50',
  },
} as const satisfies Record<Language, unknown>

/**
 * The visit page's routes with the invoice and the owner's balance kept as the API keeps them: a payment, taken
 * against the invoice's version, issues a draft and pays it down, and the owner owes the rest. `refuse` answers the
 * payment as the API does when less is owed than asked.
 */
function stubPaymentApi(server: { visit: Visit; invoice: Invoice; refuse?: Invoice }, language: Language) {
  const ifMatches: (string | null)[] = []
  const asked = stubApi(fetchMock, {
    // The login's language, which the app follows once signed in.
    'GET /api/me': () => Response.json(meOf({ language })),
    [`GET ${practicePath}/visits`]: () => Response.json({ day: '2026-10-27', visits: [] }),
    [`GET ${visitPath}`]: () => Response.json(server.visit),
    [`GET ${visitPath}/observations`]: () => Response.json({ observations: [] }),
    [`GET ${practicePath}/patients/${server.visit.patient.id}/last-weight`]: () => Response.json({ lastWeight: null }),
    [`GET ${visitPath}/invoice`]: () => Response.json({ invoice: server.invoice }),
    [`GET ${practicePath}/services`]: () => Response.json({ services: [] }),
    [`PUT ${paymentsPath}*`]: (body) => {
      if (server.refuse) {
        server.invoice = server.refuse
        return Response.json(
          {
            type: 'about:blank',
            title: 'More than is still owed on the invoice',
            status: 409,
            errors: [{ path: ['amountMinor'], code: 'above_remainder', message: 'At most what is still owed' }],
          },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        )
      }
      const { amountMinor } = body as { amountMinor: number }
      const paid = server.invoice.paidMinor + amountMinor
      server.invoice = { ...invoiceOf('issued', paid), version: server.invoice.status === 'draft' ? 4 : 4 }
      server.visit = visitOf(server.visit.status, 4350 - paid)
      return Response.json(server.invoice, { headers: { etag: `"${server.invoice.version}"` } })
    },
  })
  const routed = fetchMock.getMockImplementation()
  if (!routed) throw new Error('stubApi answers through the mock implementation')
  fetchMock.mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : new Request(String(input), init)
    if (request.method === 'PUT') ifMatches.push(request.headers.get('if-match'))
    return routed(input, init)
  })
  const payments = () => asked.filter((request) => request.method === 'PUT' && request.path.startsWith(paymentsPath))
  return { payments, ifMatches }
}

/** The patient header, found by the patient's name, its h1. */
const header = () => screen.getByRole('heading', { level: 1, name: 'Şəkər' }).closest('header') as HTMLElement

/** The header once the visit has loaded. */
const loadedHeader = async () => {
  await screen.findByRole('heading', { level: 1, name: 'Şəkər' })
  return header()
}

/** The dialog, once open. */
const dialogNamed = (title: string) => screen.findByRole('dialog', { name: title })

/** Text as written: the default matcher folds the money format's no-break spaces into plain ones. */
const asWritten = { normalizer: getDefaultNormalizer({ collapseWhitespace: false }) }

describe('Take payment on the visit page (#26, seam 3)', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    localStorage.clear()
    setLanguage('az')
    dismissToast()
  })

  it.each(languages)(
    'in %s: the dialog prefills what is owed, a smaller amount is a part payment, and Balance due beside the owner follows; axe finds no violation',
    async (language) => {
      const server = { visit: visitOf('finalised', 4350), invoice: invoiceOf('issued') }
      const { payments, ifMatches } = stubPaymentApi(server, language)
      setLanguage(language)
      const user = userEvent.setup()
      renderApp(`/visits/${visitId}`)
      const expected = words[language]

      // Completed: Take payment is the header's one action, its primary one; the owner owes the invoice.
      const take = await within(await loadedHeader()).findByRole('button', { name: expected.take })
      expect(take).toHaveClass('vt-btn-primary')
      expect(within(header()).getByText(expected.owes('43.50'), asWritten)).toBeInTheDocument()

      await user.click(take)
      const dialog = await dialogNamed(expected.take)
      const amount = within(dialog).getByRole('textbox', { name: expected.amount })
      expect(amount).toHaveValue(expected.typed('43.50'))
      expect(within(dialog).getByText(expected.owes('43.50'), asWritten)).toBeInTheDocument()
      expect(within(dialog).getByRole('group', { name: expected.method })).toBeInTheDocument()
      expect(within(dialog).getByRole('radio', { name: expected.cash })).toBeChecked()
      expect(violationsOf(await axe(document.body, axeOptions))).toEqual([])

      await user.clear(amount)
      await user.type(amount, expected.typed('10.5'))
      await user.click(within(dialog).getByRole('button', { name: expected.record }))

      expect(await screen.findByText(expected.recorded)).toBeInTheDocument()
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(payments().map((request) => request.body)).toEqual([{ amountMinor: 1050, method: 'cash' }])
      expect(ifMatches).toEqual(['"4"'])
      // The card says what was paid under its title, and the header the rest owed.
      const card = screen.getByRole('region', { name: expected.invoice })
      expect(within(card).getByText(expected.partlyPaid, { selector: 'p' })).toBeInTheDocument()
      await waitFor(() => expect(within(header()).getByText(expected.owes('33.00'), asWritten)).toBeInTheDocument())
      expect(within(header()).getByRole('button', { name: expected.take })).toBeInTheDocument()
    },
  )

  it.each(languages)(
    'in %s: zero, more than is owed and what is not an amount are refused under the field, and nothing is sent',
    async (language) => {
      const server = { visit: visitOf('finalised', 4350), invoice: invoiceOf('issued') }
      const { payments } = stubPaymentApi(server, language)
      setLanguage(language)
      const user = userEvent.setup()
      renderApp(`/visits/${visitId}`)
      const expected = words[language]

      await user.click(await within(await loadedHeader()).findByRole('button', { name: expected.take }))
      const dialog = await dialogNamed(expected.take)
      const amount = within(dialog).getByRole('textbox', { name: expected.amount })
      const record = within(dialog).getByRole('button', { name: expected.record })

      for (const [typed, error] of [
        ['0', expected.positive],
        [expected.typed('43.51'), expected.max('43.50')],
        [expected.typed('12.345'), expected.format],
        ['abc', expected.format],
      ] as const) {
        await user.clear(amount)
        await user.type(amount, typed)
        await user.click(record)
        await waitFor(() => expect(within(dialog).getByText(error, asWritten)).toBeInTheDocument())
        expect(amount).toHaveAttribute('aria-invalid', 'true')
      }
      expect(violationsOf(await axe(document.body, axeOptions))).toEqual([])
      expect(payments()).toEqual([])
    },
  )

  it('on a draft visit Take payment is a secondary action beside Complete visit; paying the whole by card issues the invoice, paid', async () => {
    const server = { visit: visitOf('draft', null), invoice: invoiceOf('draft') }
    const { payments, ifMatches } = stubPaymentApi(server, 'en')
    setLanguage('en')
    const user = userEvent.setup()
    renderApp(`/visits/${visitId}`)
    const expected = words.en

    const take = await within(await loadedHeader()).findByRole('button', { name: expected.take })
    expect(take).not.toHaveClass('vt-btn-primary')
    expect(
      within(header())
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual([expected.cancel, expected.take, expected.complete])
    // Nothing charged yet: no Balance due beside the owner.
    expect(within(header()).queryByText(/Balance due/)).toBeNull()

    await user.click(take)
    const dialog = await dialogNamed(expected.take)
    await user.click(within(dialog).getByRole('radio', { name: expected.card }))
    await user.click(within(dialog).getByRole('button', { name: expected.record }))

    expect(await screen.findByText(expected.recorded)).toBeInTheDocument()
    expect(payments().map((request) => request.body)).toEqual([{ amountMinor: 4350, method: 'card' }])
    expect(ifMatches).toEqual(['"3"'])
    const card = await screen.findByRole('region', { name: expected.invoice })
    expect(within(card).getByText(expected.paid, { selector: 'p' })).toBeInTheDocument()
    // Nothing is owed: Take payment is gone, and so is Balance due.
    await waitFor(() => expect(within(header()).queryByRole('button', { name: expected.take })).toBeNull())
    expect(within(header()).queryByText(/Balance due/)).toBeNull()
  })

  it.each([
    ['part of it', 2350, '20.00'],
    ['all of it', 4350, '0.00'],
  ])(
    'when another payment of %s came first, the dialog stays and the refusal says how much is owed now',
    async (_what, paidFirst, owedNow) => {
      const server = {
        visit: visitOf('finalised', 4350),
        invoice: invoiceOf('issued'),
        refuse: invoiceOf('issued', paidFirst),
      }
      stubPaymentApi(server, 'en')
      setLanguage('en')
      const user = userEvent.setup()
      renderApp(`/visits/${visitId}`)
      const expected = words.en

      await user.click(await within(await loadedHeader()).findByRole('button', { name: expected.take }))
      const dialog = await dialogNamed(expected.take)
      await user.click(within(dialog).getByRole('button', { name: expected.record }))

      await waitFor(() => expect(within(dialog).getByText(expected.max(owedNow), asWritten)).toBeInTheDocument())
      expect(within(dialog).getByRole('textbox', { name: expected.amount })).toHaveAttribute('aria-invalid', 'true')
      expect(screen.queryByText(expected.recorded)).toBeNull()
    },
  )
})
