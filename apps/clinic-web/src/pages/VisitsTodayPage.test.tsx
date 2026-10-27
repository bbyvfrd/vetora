import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { VisitsToday } from '@vetora/contracts'
import { languages } from '@vetora/i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { setLanguage } from '../i18n'
import { type Answer, axeOptions, meOf, problemAnswer, renderApp, stubApi, violationsOf } from '../test-support'

const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', mock)
  return mock
})

const me = meOf()
const visitsPath = `/api/p/${me.practice.id}/visits`
const leyla = { id: me.id, displayName: 'Leyla Həsənova' }

/**
 * Five visits, newest first: two completed at 10:30 and 10:00 whose invoices are paid and partly paid (#26), a draft
 * at 09:40 with no invoice yet, a draft at 09:05 with a draft invoice (#25), and one completed at 00:30 in Baku (20:30
 * UTC the day before) with its invoice issued and unpaid.
 */
const today: VisitsToday = {
  day: '2026-10-27',
  visits: [
    {
      id: '019a3f00-0000-7000-8000-0000000000f5',
      status: 'finalised',
      startedAt: '2026-10-27T06:30:00.000Z',
      patient: { id: '019a3f00-0000-7000-8000-0000000000e5', name: 'Mestan' },
      client: {
        id: '019a3f00-0000-7000-8000-00000000c1e3',
        firstName: 'Nərmin',
        lastName: 'Qasımova',
        patronymic: null,
      },
      veterinarian: leyla,
      invoice: 'paid',
    },
    {
      id: '019a3f00-0000-7000-8000-0000000000f4',
      status: 'finalised',
      startedAt: '2026-10-27T06:00:00.000Z',
      patient: { id: '019a3f00-0000-7000-8000-0000000000e4', name: 'Toplan' },
      client: {
        id: '019a3f00-0000-7000-8000-00000000c1e3',
        firstName: 'Nərmin',
        lastName: 'Qasımova',
        patronymic: null,
      },
      veterinarian: leyla,
      invoice: 'partly_paid',
    },
    {
      id: '019a3f00-0000-7000-8000-0000000000f3',
      status: 'draft',
      startedAt: '2026-10-27T05:40:00.000Z',
      patient: { id: '019a3f00-0000-7000-8000-0000000000e3', name: 'Pambıq' },
      client: { id: '019a3f00-0000-7000-8000-00000000c1e2', firstName: 'Rəşad', lastName: 'Əliyev', patronymic: null },
      veterinarian: leyla,
      invoice: 'none',
    },
    {
      id: '019a3f00-0000-7000-8000-0000000000f2',
      status: 'draft',
      startedAt: '2026-10-27T05:05:00.000Z',
      patient: { id: '019a3f00-0000-7000-8000-0000000000e2', name: 'Bəbir' },
      client: { id: '019a3f00-0000-7000-8000-00000000c1e2', firstName: 'Rəşad', lastName: 'Əliyev', patronymic: null },
      veterinarian: leyla,
      invoice: 'draft',
    },
    {
      id: '019a3f00-0000-7000-8000-0000000000f1',
      status: 'finalised',
      startedAt: '2026-10-26T20:30:00.000Z',
      patient: { id: '019a3f00-0000-7000-8000-0000000000e1', name: 'Şəkər' },
      client: {
        id: '019a3f00-0000-7000-8000-00000000c1e1',
        firstName: 'Aysel',
        lastName: 'Məmmədova',
        patronymic: null,
      },
      veterinarian: leyla,
      invoice: 'unpaid',
    },
  ],
}

const words = {
  az: {
    title: 'Bugünkü qəbullar',
    columns: ['Vaxt', 'Pasiyent', 'Müştəri', 'Həkim', 'Status', 'Hesab-faktura'],
    draft: 'Qaralama',
    completed: 'Tamamlanıb',
    unpaid: 'Ödənilməyib',
    partlyPaid: 'Qismən ödənilib',
    paid: 'Ödənilib',
    empty: 'Bu gün qəbul yoxdur',
    failed: 'Səhifəni yükləmək mümkün olmadı',
    retry: 'Yenidən cəhd et',
  },
  ru: {
    title: 'Приёмы сегодня',
    columns: ['Время', 'Пациент', 'Клиент', 'Врач', 'Статус', 'Счёт'],
    draft: 'Черновик',
    completed: 'Завершён',
    unpaid: 'Не оплачен',
    partlyPaid: 'Оплачен частично',
    paid: 'Оплачен',
    empty: 'Сегодня приёмов нет',
    failed: 'Не удалось загрузить страницу',
    retry: 'Повторить',
  },
  en: {
    title: 'Visits today',
    columns: ['Time', 'Patient', 'Client', 'Vet', 'Status', 'Invoice'],
    draft: 'Draft',
    completed: 'Completed',
    unpaid: 'Unpaid',
    partlyPaid: 'Partly paid',
    paid: 'Paid',
    empty: 'No visits today',
    failed: 'This page could not be loaded',
    retry: 'Try again',
  },
} as const

function stubVisits(answer: () => Answer, who = me) {
  return stubApi(fetchMock, {
    'GET /api/me': () => Response.json(who),
    [`GET ${visitsPath}`]: answer,
  })
}

describe("Visits today: the day's visits at the location (#22, seam 3)", () => {
  beforeEach(() => {
    fetchMock.mockReset()
    localStorage.clear()
    setLanguage('az')
  })

  it.each(languages)(
    "in %s: lists each visit with its time in the practice clock, patient, client, vet, state and its invoice's state (none, draft, unpaid, partly paid, paid), newest first; axe finds no violation",
    async (language) => {
      stubVisits(() => Response.json(today), meOf({ language }))
      setLanguage(language)
      renderApp('/')
      const expected = words[language]

      const table = await screen.findByRole('table', { name: expected.title })
      expect(
        within(table)
          .getAllByRole('columnheader')
          .map((cell) => cell.textContent),
      ).toEqual(expected.columns)
      const rows = within(table)
        .getAllByRole('row')
        .slice(1)
        .map((row) =>
          within(row)
            .getAllByRole('cell')
            .map((cell) => cell.textContent),
        )
      expect(rows).toEqual([
        ['10:30', 'Mestan', 'Qasımova Nərmin', 'Leyla Həsənova', expected.completed, expected.paid],
        ['10:00', 'Toplan', 'Qasımova Nərmin', 'Leyla Həsənova', expected.completed, expected.partlyPaid],
        ['09:40', 'Pambıq', 'Əliyev Rəşad', 'Leyla Həsənova', expected.draft, ''],
        ['09:05', 'Bəbir', 'Əliyev Rəşad', 'Leyla Həsənova', expected.draft, expected.draft],
        ['00:30', 'Şəkər', 'Məmmədova Aysel', 'Leyla Həsənova', expected.completed, expected.unpaid],
      ])
      expect(violationsOf(await axe(document.body, axeOptions))).toEqual([])
    },
  )

  it('opens a visit from its row, and asks for the list at the default location', async () => {
    stubApi(fetchMock, {
      'GET /api/me': () => Response.json(me),
      [`GET ${visitsPath}`]: () => Response.json(today),
      [`GET ${visitsPath}/019a3f00-0000-7000-8000-0000000000f2`]: () => problemAnswer(500, 'Internal server error'),
    })
    const { router } = renderApp('/')

    await userEvent.setup().click(await screen.findByRole('cell', { name: 'Bəbir' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/visits/019a3f00-0000-7000-8000-0000000000f2'))
    const asked = fetchMock.mock.calls
      .map(([input]) => input)
      .find((input): input is Request => input instanceof Request && new URL(input.url).pathname === visitsPath)
    expect(asked?.headers.get('vetora-location')).toBe(me.locations[0]?.id)
  })

  it('shows the empty state when the day has no visits, and the frame while the list loads', async () => {
    let answer: (value: Response) => void = () => {}
    stubVisits(() => new Promise<Response>((resolve) => (answer = resolve)) as unknown as Response)
    renderApp('/')

    const region = await screen.findByRole('region', { name: 'Bugünkü qəbullar' })
    expect(region).toHaveAttribute('aria-busy', 'true')
    answer(Response.json({ day: '2026-10-27', visits: [] }))

    expect(await within(region).findByText('Bu gün qəbul yoxdur')).toBeInTheDocument()
    expect(region).not.toHaveAttribute('aria-busy')
  })

  it('says the list could not be loaded, never an empty list, and Try again asks again', async () => {
    let calls = 0
    stubVisits(() => (++calls === 1 ? problemAnswer(500, 'Internal server error') : Response.json(today)))
    renderApp('/')

    expect(await screen.findByText('Səhifəni yükləmək mümkün olmadı')).toBeInTheDocument()
    expect(screen.queryByText('Bu gün qəbul yoxdur')).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Yenidən cəhd et' }))

    expect(await screen.findByRole('cell', { name: 'Şəkər' })).toBeInTheDocument()
  })
})
