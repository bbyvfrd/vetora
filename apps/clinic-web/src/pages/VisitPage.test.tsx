import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Visit } from '@vetora/contracts'
import { languages } from '@vetora/i18n'
import { dismissToast } from '@vetora/ui'
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
const visitId = '019a3f00-0000-7000-8000-0000000000f1'
const visitPath = `/api/p/${me.practice.id}/visits/${visitId}`

const emptyNote = {
  reasonForVisit: '',
  anamnesis: '',
  examination: '',
  diagnosis: '',
  treatment: '',
  recommendations: '',
}

/** A draft visit of Şəkər, a neutered female cat born on 1 March 2022, started by Leyla at 09:05 in Baku. */
const draft: Visit = {
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
    phone: '050 123 45 67',
  },
  note: emptyNote,
}

/** The visit page's words in each language, from the design system glossary and messages through packages/i18n. */
const words = {
  az: {
    sections: ['Müraciət səbəbi', 'Anamnez', 'Müayinə', 'Diaqnoz', 'Müalicə', 'Tövsiyələr'],
    note: 'Qəbul qeydi',
    complete: 'Qəbulu tamamla',
    cancel: 'Qəbulu ləğv et',
    keep: 'Qəbulu saxla',
    blocked: 'Müraciət səbəbini daxil edin',
    confirmTitle: 'Qəbul ləğv edilsin?',
    confirmBody: 'Qəbul bugünkü qəbullar siyahısından çıxarılacaq.',
    species: 'Növ',
    sex: 'Cinsiyyət',
    sexValue: 'Dişi, qısırlaşdırılıb',
    owner: 'Sahib',
    notRecorded: 'Qeyd edilməyib',
    saved: 'Yadda saxlanıldı',
    notSaved: 'Yadda saxlanılmayıb',
    completed: 'Qəbul tamamlandı',
    cancelled: 'Qəbul ləğv edildi',
  },
  ru: {
    sections: ['Причина обращения', 'Анамнез', 'Осмотр', 'Диагноз', 'Лечение', 'Рекомендации'],
    note: 'Протокол приёма',
    complete: 'Завершить приём',
    cancel: 'Отменить приём',
    keep: 'Оставить приём',
    blocked: 'Введите причину обращения',
    confirmTitle: 'Отменить приём?',
    confirmBody: 'Приём будет убран из списка приёмов на сегодня.',
    species: 'Вид',
    sex: 'Пол',
    sexValue: 'Самка, стерилизована',
    owner: 'Владелец',
    notRecorded: 'Не указано',
    saved: 'Сохранено',
    notSaved: 'Не сохранено',
    completed: 'Приём завершён',
    cancelled: 'Приём отменён',
  },
  en: {
    sections: ['Reason for visit', 'History', 'Examination', 'Diagnosis', 'Treatment', 'Recommendations'],
    note: 'Visit note',
    complete: 'Complete visit',
    cancel: 'Cancel visit',
    keep: 'Keep visit',
    blocked: 'Enter the reason for visit',
    confirmTitle: 'Cancel the visit?',
    confirmBody: 'The visit is removed from Visits today.',
    species: 'Species',
    sex: 'Sex',
    sexValue: 'Female, neutered',
    owner: 'Owner',
    notRecorded: 'Not recorded',
    saved: 'Saved',
    notSaved: 'Not saved',
    completed: 'Visit completed',
    cancelled: 'Visit cancelled',
  },
} as const

type Stub = {
  visit?: () => Visit
  note?: (body: unknown) => Answer
  complete?: () => Answer
  cancel?: () => Answer
}

/** The API the visit page talks to: the visit as `visit()` returns it, and its three changes. */
function stubVisit({ visit = () => draft, note, complete, cancel }: Stub = {}, who = me) {
  return stubApi(fetchMock, {
    'GET /api/me': () => Response.json(who),
    [`GET /api/p/${me.practice.id}/visits`]: () => Response.json({ day: '2026-10-27', visits: [] }),
    [`GET ${visitPath}`]: () => Response.json(visit()),
    [`PUT ${visitPath}/note`]: note ?? (() => Response.json({ version: 2 })),
    [`POST ${visitPath}/complete`]: complete ?? (() => Response.json({ version: 3 })),
    [`POST ${visitPath}/cancel`]: cancel ?? (() => Response.json({ version: 2 })),
  })
}

/** The `If-Match` each change to the visit carried, by path. */
function versionsSent(): Record<string, (string | null)[]> {
  const sent: Record<string, (string | null)[]> = {}
  for (const [input] of fetchMock.mock.calls) {
    if (!(input instanceof Request) || input.method === 'GET') continue
    const path = new URL(input.url).pathname
    sent[path] = [...(sent[path] ?? []), input.headers.get('if-match')]
  }
  return sent
}

async function openVisit(language: keyof typeof words = 'az') {
  renderApp(`/visits/${visitId}`)
  await screen.findByRole('heading', { level: 1, name: 'Şəkər' })
  return words[language]
}

const sectionField = (label: string) => screen.getByRole('textbox', { name: label })

describe('the visit page: the patient header and the note (#22, seam 3)', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    localStorage.clear()
    setLanguage('az')
    dismissToast()
  })

  it.each(languages)(
    'in %s: the patient header, then the six sections in order with their labels; axe finds no violation',
    async (language) => {
      stubVisit({}, meOf({ language }))
      setLanguage(language)
      const expected = await openVisit(language)

      const header = screen.getByRole('heading', { level: 1, name: 'Şəkər' }).closest('header') as HTMLElement
      expect(within(header).getByText(expected.species).nextElementSibling?.textContent).toBe(
        { az: 'Pişik', ru: 'Кошка', en: 'Cat' }[language],
      )
      expect(within(header).getByText(expected.sexValue)).toBeInTheDocument()
      expect(within(header).getByText(expected.owner)).toBeInTheDocument()
      expect(within(header).getByText('Məmmədova Aysel')).toBeInTheDocument()
      // The phone as the design system writes it, its parts joined by non breaking spaces, dialling the number.
      expect(within(header).getByRole('link', { name: /^\+994\s50\s123\s45\s67$/ })).toHaveAttribute(
        'href',
        'tel:+994501234567',
      )
      const fields = expected.sections.map((label) => screen.getByRole('textbox', { name: label }))
      expect(screen.getAllByRole('textbox')).toEqual(fields)
      expect(screen.getByRole('button', { name: expected.complete })).toBeInTheDocument()
      expect(violationsOf(await axe(document.body, axeOptions))).toEqual([])
    },
  )

  it("saves the six sections when the vet leaves a section, against the visit's version, and says so", async () => {
    const asked = stubVisit()
    const words = await openVisit()
    const user = userEvent.setup()

    await user.type(sectionField(words.sections[2]), 'Quiet, mildly dehydrated')
    await user.tab()

    expect(await screen.findByText(words.saved)).toBeInTheDocument()
    expect(asked.filter((request) => request.method === 'PUT').map((request) => request.body)).toEqual([
      { ...emptyNote, examination: 'Quiet, mildly dehydrated' },
    ])
    expect(versionsSent()[`${visitPath}/note`]).toEqual(['"1"'])
    // Leaving again with nothing new sends nothing.
    await user.click(sectionField(words.sections[2]))
    await user.tab()
    expect(asked.filter((request) => request.method === 'PUT')).toHaveLength(1)
  })

  it('says "not saved" when the save is refused as stale, and keeps the text', async () => {
    stubVisit({ note: () => problemAnswer(412, 'The visit changed since it was read') })
    const words = await openVisit()
    const user = userEvent.setup()

    await user.type(sectionField(words.sections[0]), 'Limping')
    await user.tab()

    expect(await screen.findByText(words.notSaved)).toBeInTheDocument()
    expect(sectionField(words.sections[0])).toHaveValue('Limping')
  })

  it.each(languages)(
    'in %s: Complete visit with a blank reason says what to enter under it, moves the focus there and sends nothing',
    async (language) => {
      const asked = stubVisit({}, meOf({ language }))
      setLanguage(language)
      const expected = await openVisit(language)
      const user = userEvent.setup()
      await user.type(sectionField(expected.sections[2]), 'Quiet')

      await user.click(screen.getByRole('button', { name: expected.complete }))

      const reason = sectionField(expected.sections[0])
      expect(await screen.findByText(expected.blocked)).toBeInTheDocument()
      await waitFor(() => expect(reason).toHaveFocus())
      expect(reason).toHaveAttribute('aria-invalid', 'true')
      expect(asked.some((request) => request.path.endsWith('/complete'))).toBe(false)
      expect(sectionField(expected.sections[2])).toHaveValue('Quiet')
      // Typing a reason clears the message.
      await user.type(reason, 'Limping')
      expect(screen.queryByText(expected.blocked)).toBeNull()
    },
  )

  it('Complete visit saves what is typed, completes against the saved version, and shows the note read only with the empty sections as not recorded', async () => {
    let completed = false
    const asked = stubVisit({
      visit: () =>
        completed
          ? {
              ...draft,
              status: 'finalised',
              version: 3,
              finalisedAt: '2026-10-27T05:40:00.000Z',
              note: { ...emptyNote, reasonForVisit: 'Limping' },
            }
          : draft,
      complete: () => {
        completed = true
        return Response.json({ version: 3 })
      },
    })
    const words = await openVisit()
    const user = userEvent.setup()
    await user.type(sectionField(words.sections[0]), 'Limping')

    await user.click(screen.getByRole('button', { name: words.complete }))

    expect(await screen.findByText(words.completed)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryAllByRole('textbox')).toEqual([]))
    expect(screen.getByText('Limping')).toBeInTheDocument()
    expect(screen.getAllByText(words.notRecorded)).toHaveLength(5)
    expect(screen.queryByRole('button', { name: words.complete })).toBeNull()
    expect(screen.queryByRole('button', { name: words.cancel })).toBeNull()
    expect(asked.filter((request) => request.method !== 'GET').map((request) => request.path)).toEqual([
      `${visitPath}/note`,
      `${visitPath}/complete`,
    ])
    expect(versionsSent()).toEqual({ [`${visitPath}/note`]: ['"1"'], [`${visitPath}/complete`]: ['"2"'] })
  })

  it.each(languages)(
    'in %s: Cancel visit asks first; Keep visit keeps it, and Cancel visit discards it and returns to Visits today',
    async (language) => {
      const asked = stubVisit({}, meOf({ language }))
      setLanguage(language)
      const expected = await openVisit(language)
      const user = userEvent.setup()

      await user.click(screen.getByRole('button', { name: expected.cancel }))
      const dialog = await screen.findByRole('dialog', { name: expected.confirmTitle })
      expect(within(dialog).getByText(expected.confirmBody)).toBeInTheDocument()
      expect(violationsOf(await axe(document.body, axeOptions))).toEqual([])
      await user.click(within(dialog).getByRole('button', { name: expected.keep }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(asked.some((request) => request.path.endsWith('/cancel'))).toBe(false)

      await user.click(screen.getByRole('button', { name: expected.cancel }))
      const again = await screen.findByRole('dialog', { name: expected.confirmTitle })
      await user.click(within(again).getByRole('button', { name: expected.cancel }))

      expect(await screen.findByText(expected.cancelled)).toBeInTheDocument()
      expect(
        await screen.findByRole('heading', {
          level: 1,
          name: { az: 'Bugünkü qəbullar', ru: 'Приёмы сегодня', en: 'Visits today' }[language],
        }),
      ).toBeInTheDocument()
      expect(versionsSent()[`${visitPath}/cancel`]).toEqual(['"1"'])
    },
  )

  it('an assistant writes into the draft but sees neither Complete visit nor Cancel visit; a receptionist reads it', async () => {
    const assistant = meOf({ practice: { ...me.practice, roles: ['assistant'] } })
    stubVisit({}, assistant)
    const words = await openVisit()

    expect(screen.getAllByRole('textbox')).toHaveLength(6)
    expect(screen.queryByRole('button', { name: words.complete })).toBeNull()
    expect(screen.queryByRole('button', { name: words.cancel })).toBeNull()
  })

  it('shows a receptionist the draft as text', async () => {
    stubVisit({}, meOf({ practice: { ...me.practice, roles: ['receptionist'] } }))
    const words = await openVisit()

    expect(screen.queryAllByRole('textbox')).toEqual([])
    expect(screen.getAllByText(words.notRecorded)).toHaveLength(6)
  })
})
