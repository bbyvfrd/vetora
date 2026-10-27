import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Observation, Visit } from '@vetora/contracts'
import { languages } from '@vetora/i18n'
import { dismissToast } from '@vetora/ui'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { setLanguage } from '../i18n'
import { uuidv7 } from '../ids'
import {
  type Answer,
  type Asked,
  axeOptions,
  meOf,
  problemAnswer,
  renderApp,
  stubApi,
  violationsOf,
} from '../test-support'

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

/** A reading as the API answers it, measured by Tural at `occurredAt`. */
const reading = (kind: Observation['kind'], value: number, occurredAt = '2026-10-27T05:10:00.000Z'): Observation => ({
  id: uuidv7(),
  kind,
  value,
  unit: { weight: 'kg', temperature: '°C', pulse: '/min', respiratory_rate: '/min', body_condition: '/9', other: '' }[
    kind
  ],
  occurredAt,
  measuredBy: { id: '019a3f00-0000-7000-8000-0000000000d1', displayName: 'Tural Quliyev' },
})

/** Şəkər's last weight before today: 3.9 kg on 3 June 2026, at 10:00 in Baku. */
const lastWeighed = reading('weight', 3.9, '2026-06-03T06:00:00.000Z')

/**
 * The vital signs' words in each language: the four labels and their units in the design system's order (its VisitPage
 * example: temperature, pulse, respiratory rate, weight), and the last weight's line.
 */
const vitalWords = {
  az: {
    labels: ['Temperatur', 'Nəbz', 'Tənəffüs tezliyi', 'Çəki'],
    units: ['°C', '/dəq', '/dəq', 'kq'],
    lastWeight: 'Son çəki: 3,9 kq, 03.06.2026',
    temperatureError: 'Temperaturu °C ilə daxil edin, məsələn 38,5',
  },
  ru: {
    labels: ['Температура', 'Пульс', 'Частота дыхания', 'Вес'],
    units: ['°C', '/мин', '/мин', 'кг'],
    lastWeight: 'Последний вес: 3,9 кг, 03.06.2026',
    temperatureError: 'Введите температуру в °C, например 38,5',
  },
  en: {
    labels: ['Temperature', 'Pulse', 'Respiratory rate', 'Weight'],
    units: ['°C', '/min', '/min', 'kg'],
    lastWeight: 'Last weight: 3.9 kg, 3 Jun 2026',
    temperatureError: 'Enter the temperature in °C, such as 38.5',
  },
} as const

type Stub = {
  visit?: () => Visit
  note?: (body: unknown) => Answer
  complete?: () => Answer
  cancel?: () => Answer
  observations?: () => Observation[]
  lastWeight?: () => Observation | null
  record?: (body: unknown) => Answer | Promise<Answer>
}

/** The API the visit page talks to: the visit as `visit()` returns it, its three changes, and its vital signs. */
function stubVisit(
  { visit = () => draft, note, complete, cancel, observations = () => [], lastWeight = () => null, record }: Stub = {},
  who = me,
) {
  return stubApi(fetchMock, {
    'GET /api/me': () => Response.json(who),
    [`GET /api/p/${me.practice.id}/visits`]: () => Response.json({ day: '2026-10-27', visits: [] }),
    [`GET ${visitPath}`]: () => Response.json(visit()),
    [`PUT ${visitPath}/note`]: note ?? (() => Response.json({ version: 2 })),
    [`POST ${visitPath}/complete`]: complete ?? (() => Response.json({ version: 3 })),
    [`POST ${visitPath}/cancel`]: cancel ?? (() => Response.json({ version: 2 })),
    [`GET ${visitPath}/observations`]: () => Response.json({ observations: observations() }),
    [`PUT ${visitPath}/observations/*`]:
      record ??
      ((body) => {
        const { kind, value } = body as { kind: Observation['kind']; value: number }
        return Response.json(reading(kind, value, new Date().toISOString()))
      }),
    [`GET /api/p/${me.practice.id}/patients/${draft.patient.id}/last-weight`]: () =>
      Response.json({ lastWeight: lastWeight() }),
  })
}

/** The readings the page sent, in order: what each body said, and the id in its path. */
function readingsSent(asked: Asked[]) {
  return asked
    .filter((request) => request.method === 'PUT' && request.path.startsWith(`${visitPath}/observations/`))
    .map((request) => ({ id: request.path.split('/').pop(), body: request.body }))
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
      const vitals = vitalWords[language].labels.map((label) => screen.getByRole('textbox', { name: label }))
      const fields = expected.sections.map((label) => screen.getByRole('textbox', { name: label }))
      expect(screen.getAllByRole('textbox')).toEqual([...vitals, ...fields])
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
    // The five empty sections and the four vital signs nobody recorded.
    expect(screen.getAllByText(words.notRecorded)).toHaveLength(9)
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

    // The four vital signs and the six sections, every one writable.
    expect(screen.getAllByRole('textbox')).toHaveLength(10)
    expect(screen.getAllByRole('textbox').filter((field) => field.hasAttribute('readonly'))).toEqual([])
    expect(screen.queryByRole('button', { name: words.complete })).toBeNull()
    expect(screen.queryByRole('button', { name: words.cancel })).toBeNull()
  })

  it('shows a manager the draft as text, the vital signs too', async () => {
    stubVisit({}, meOf({ practice: { ...me.practice, roles: ['manager'] } }))
    const words = await openVisit()

    expect(screen.queryAllByRole('textbox')).toEqual([])
    expect(screen.getAllByText(words.notRecorded)).toHaveLength(10)
  })
})

describe('the visit page: the vital signs (#23, seam 3)', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    localStorage.clear()
    setLanguage('az')
    dismissToast()
  })

  const vitalField = (label: string) => screen.getByRole('textbox', { name: label })

  it.each(languages)(
    'in %s: weight, temperature, pulse and respiratory rate with their units, the last weight and its date under the weight; axe finds no violation',
    async (language) => {
      stubVisit({ lastWeight: () => lastWeighed }, meOf({ language }))
      setLanguage(language)
      await openVisit(language)
      const expected = vitalWords[language]

      const fields = expected.labels.map(vitalField)
      expect(fields.map((field) => field.closest('.vt-input')?.textContent)).toEqual(expected.units)
      expect(await screen.findByText(expected.lastWeight)).toBeInTheDocument()
      // The line's parts are joined by non breaking spaces, which the text query reads as spaces.
      expect(fields[3]).toHaveAccessibleDescription(
        new RegExp(`^${expected.lastWeight.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&').replace(/ /g, '\\s')}$`),
      )
      expect(violationsOf(await axe(document.body, axeOptions))).toEqual([])
    },
  )

  it('the last weight under the field is the one from before this visit, and stays so once a weight is recorded here', async () => {
    const asked = stubVisit({ lastWeight: () => lastWeighed })
    await openVisit()
    const user = userEvent.setup()
    const weight = vitalField(vitalWords.az.labels[3])
    expect(await screen.findByText(vitalWords.az.lastWeight)).toBeInTheDocument()

    await user.type(weight, '4,2')
    await user.tab()

    await waitFor(() => expect(readingsSent(asked)).toHaveLength(1))
    expect(screen.getByText(vitalWords.az.lastWeight)).toBeInTheDocument()
    const lastWeightAsked = fetchMock.mock.calls
      .map(([input]) => new URL((input as Request).url))
      .filter((url) => url.pathname.endsWith('/last-weight'))
    expect(lastWeightAsked.map((url) => url.searchParams.get('excludingVisit'))).toEqual([visitId])
  })

  it('a value corrected back before the first correction is saved still ends as the newest reading', async () => {
    let letThrough: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      letThrough = resolve
    })
    const asked = stubVisit({
      observations: () => [reading('weight', 4.2)],
      record: async (body) => {
        await held
        const { kind, value } = body as { kind: Observation['kind']; value: number }
        return Response.json(reading(kind, value))
      },
    })
    await openVisit()
    const user = userEvent.setup()
    const weight = vitalField(vitalWords.az.labels[3])

    await user.clear(weight)
    await user.type(weight, '4,3')
    await user.tab()
    await user.clear(weight)
    await user.type(weight, '4,2')
    await user.tab()
    letThrough()

    await waitFor(() =>
      expect(readingsSent(asked).map((sent) => sent.body)).toEqual([
        { kind: 'weight', value: 4.3, unit: 'kg' },
        { kind: 'weight', value: 4.2, unit: 'kg' },
      ]),
    )
  })

  it("fills each field with the visit's newest reading of its kind, a corrected weight over the first", async () => {
    stubVisit({
      observations: () => [reading('weight', 4.2), reading('temperature', 38.6), reading('weight', 4.25)],
    })
    await openVisit()
    const [temperature, pulse, respiratory, weight] = vitalWords.az.labels.map(vitalField)

    expect(weight).toHaveValue('4,25')
    expect(temperature).toHaveValue('38,6')
    expect(pulse).toHaveValue('')
    expect(respiratory).toHaveValue('')
  })

  it('saves a reading when the field is left, in its unit, with a new id for each reading; leaving again sends nothing', async () => {
    const asked = stubVisit()
    await openVisit()
    const user = userEvent.setup()
    const [temperature, pulse, respiratory, weight] = vitalWords.az.labels.map(vitalField)

    await user.type(weight, '4,2')
    await user.type(temperature, '38,6')
    await user.type(pulse, '96')
    await user.type(respiratory, '24')
    await user.tab()

    expect(await screen.findByText(words.az.saved)).toBeInTheDocument()
    await waitFor(() => expect(readingsSent(asked)).toHaveLength(4))
    expect(readingsSent(asked).map((sent) => sent.body)).toEqual([
      { kind: 'weight', value: 4.2, unit: 'kg' },
      { kind: 'temperature', value: 38.6, unit: '°C' },
      { kind: 'pulse', value: 96, unit: '/min' },
      { kind: 'respiratory_rate', value: 24, unit: '/min' },
    ])
    await user.click(weight)
    await user.tab()
    expect(readingsSent(asked)).toHaveLength(4)

    // A corrected weight is a new reading.
    await user.clear(weight)
    await user.type(weight, '4.3')
    await user.tab()
    await waitFor(() => expect(readingsSent(asked)).toHaveLength(5))
    const ids = readingsSent(asked).map((sent) => sent.id)
    expect(new Set(ids).size).toBe(5)
    expect(readingsSent(asked)[4]?.body).toEqual({ kind: 'weight', value: 4.3, unit: 'kg' })
  })

  it.each(languages)(
    'in %s: a value outside its plausible range says what to enter under the field and sends nothing',
    async (language) => {
      const asked = stubVisit({}, meOf({ language }))
      setLanguage(language)
      await openVisit(language)
      const user = userEvent.setup()
      const temperature = vitalField(vitalWords[language].labels[0])

      await user.type(temperature, '386')
      await user.tab()

      expect(await screen.findByText(vitalWords[language].temperatureError)).toBeInTheDocument()
      expect(temperature).toHaveAttribute('aria-invalid', 'true')
      expect(temperature).toHaveAccessibleDescription(vitalWords[language].temperatureError)
      expect(readingsSent(asked)).toEqual([])
      expect(violationsOf(await axe(document.body, axeOptions))).toEqual([])
      // Typing a plausible value clears the message and saves it.
      await user.clear(temperature)
      await user.type(temperature, '38,6')
      expect(screen.queryByText(vitalWords[language].temperatureError)).toBeNull()
      await user.tab()
      await waitFor(() => expect(readingsSent(asked)).toHaveLength(1))
    },
  )

  it('each kind refuses what is not a plausible reading with its own message', async () => {
    const asked = stubVisit({}, meOf({ language: 'en' }))
    setLanguage('en')
    await openVisit('en')
    const user = userEvent.setup()
    const [, pulse, respiratory, weight] = vitalWords.en.labels.map(vitalField)

    await user.type(weight, 'four')
    await user.type(pulse, '9600')
    await user.type(respiratory, '0')
    await user.tab()

    expect(await screen.findByText('Enter the weight in kilograms, such as 4.2')).toBeInTheDocument()
    expect(screen.getByText('Enter the pulse in beats per minute, such as 90')).toBeInTheDocument()
    expect(screen.getByText('Enter the respiratory rate per minute, such as 24')).toBeInTheDocument()
    expect(readingsSent(asked)).toEqual([])
  })

  it('says "not saved" when a reading is refused, and keeps the value', async () => {
    stubVisit({ record: () => problemAnswer(409, 'Refused') })
    await openVisit()
    const user = userEvent.setup()
    const weight = vitalField(vitalWords.az.labels[3])

    await user.type(weight, '4,2')
    await user.tab()

    expect(await screen.findByText(words.az.notSaved)).toBeInTheDocument()
    expect(weight).toHaveValue('4,2')
  })

  it('a receptionist records the weight and reads the rest: the other vital signs read only, the note as text', async () => {
    const asked = stubVisit(
      { observations: () => [reading('temperature', 38.6)] },
      meOf({ practice: { ...me.practice, roles: ['receptionist'] } }),
    )
    await openVisit()
    const user = userEvent.setup()
    const [temperature, pulse, respiratory, weight] = vitalWords.az.labels.map(vitalField)

    expect(weight).not.toHaveAttribute('readonly')
    for (const field of [temperature, pulse, respiratory]) expect(field).toHaveAttribute('readonly')
    expect(temperature).toHaveValue('38,6')
    expect(screen.getAllByRole('textbox')).toHaveLength(4)
    expect(screen.getAllByText(words.az.notRecorded)).toHaveLength(6)
    expect(screen.queryByRole('button', { name: words.az.complete })).toBeNull()

    await user.type(weight, '4,2')
    await user.tab()

    await waitFor(() =>
      expect(readingsSent(asked).map((sent) => sent.body)).toEqual([{ kind: 'weight', value: 4.2, unit: 'kg' }]),
    )
  })

  it('Complete visit waits for a reading being saved, then completes; the vital signs then read as text', async () => {
    let completed = false
    const recorded: Observation[] = []
    // The reading's answer is held back until the test lets it through.
    let letThrough: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      letThrough = resolve
    })
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
      observations: () => recorded,
      record: async (body) => {
        await held
        const { kind, value } = body as { kind: Observation['kind']; value: number }
        const saved = reading(kind, value)
        recorded.push(saved)
        return Response.json(saved)
      },
      complete: () => {
        completed = true
        return Response.json({ version: 3 })
      },
    })
    await openVisit()
    const user = userEvent.setup()
    await user.type(sectionField(words.az.sections[0]), 'Limping')
    // A kitten: under one kilogram, the completed note writes the weight in grams (formats.md, Units).
    await user.type(vitalField(vitalWords.az.labels[3]), '0,85')

    await user.click(screen.getByRole('button', { name: words.az.complete }))

    await waitFor(() => expect(readingsSent(asked)).toHaveLength(1))
    expect(asked.some((request) => request.path.endsWith('/complete'))).toBe(false)
    letThrough()
    expect(await screen.findByText(words.az.completed)).toBeInTheDocument()
    expect(asked.filter((request) => request.method !== 'GET').at(-1)?.path).toBe(`${visitPath}/complete`)
    await waitFor(() => expect(screen.queryAllByRole('textbox')).toEqual([]))
    expect(screen.getByText('850 q')).toBeInTheDocument()
    // The three vital signs nobody recorded and the five empty sections.
    expect(screen.getAllByText(words.az.notRecorded)).toHaveLength(8)
  })
})
