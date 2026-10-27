import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PhoneLookupResult, SpeciesList } from '@vetora/contracts'
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
const practicePath = `/api/p/${me.practice.id}`
const dog = '019a3f00-0000-7000-8000-0000000000d1'
const cat = '019a3f00-0000-7000-8000-0000000000c1'
const species: SpeciesList = {
  species: [
    { id: dog, code: 'dog', name: { az: 'İt', ru: 'Собака', en: 'Dog' }, clinicallySupported: true, breeds: [] },
    { id: cat, code: 'cat', name: { az: 'Pişik', ru: 'Кошка', en: 'Cat' }, clinicallySupported: true, breeds: [] },
  ],
}
const aysel = {
  id: '019a3f00-0000-7000-8000-00000000c1e1',
  firstName: 'Aysel',
  lastName: 'Məmmədova',
  patronymic: null,
  preferredLanguage: 'az' as const,
  patients: [
    {
      id: '019a3f00-0000-7000-8000-0000000000e1',
      name: 'Şəkər',
      speciesId: cat,
      breedId: null,
      sex: 'female' as const,
    },
  ],
}

/** The New visit page's words in each language, from the design system glossary and messages through packages/i18n. */
const words = {
  az: {
    title: 'Yeni qəbul',
    phone: 'Telefon',
    search: 'Axtar',
    client: 'Müştəri',
    patient: 'Pasiyent',
    firstName: 'Ad',
    lastName: 'Soyad',
    patronymic: 'Ata adı',
    preferredLanguage: 'Ünsiyyət dili',
    patientName: 'Ad',
    species: 'Növ',
    breed: 'Cins',
    sex: 'Cinsiyyət',
    neutered: 'Qısırlaşdırılıb',
    colour: 'Rəng',
    microchip: 'Mikroçip nömrəsi',
    save: 'Yadda saxla',
    saved: 'Pasiyent yadda saxlanıldı',
    male: 'Erkək',
    formCheck: 'İşarələnmiş sahələri yoxlayın',
    required: 'Bu sahəni doldurun',
    clients: 'Müştərilər',
    cat: 'Pişik',
    newPatient: 'Yeni pasiyent',
    newClient: 'Yeni müştəri',
  },
  ru: {
    title: 'Новый приём',
    phone: 'Телефон',
    search: 'Найти',
    client: 'Клиент',
    patient: 'Пациент',
    firstName: 'Имя',
    lastName: 'Фамилия',
    patronymic: 'Отчество',
    preferredLanguage: 'Язык общения',
    patientName: 'Кличка',
    species: 'Вид',
    breed: 'Порода',
    sex: 'Пол',
    neutered: 'Стерилизация',
    colour: 'Окрас',
    microchip: 'Номер микрочипа',
    save: 'Сохранить',
    saved: 'Пациент сохранён',
    male: 'Самец',
    formCheck: 'Проверьте отмеченные поля',
    required: 'Заполните это поле',
    clients: 'Клиенты',
    cat: 'Кошка',
    newPatient: 'Новый пациент',
    newClient: 'Новый клиент',
  },
  en: {
    title: 'New visit',
    phone: 'Phone',
    search: 'Search',
    client: 'Client',
    patient: 'Patient',
    firstName: 'First name',
    lastName: 'Last name',
    patronymic: 'Patronymic',
    preferredLanguage: 'Preferred language',
    patientName: 'Name',
    species: 'Species',
    breed: 'Breed',
    sex: 'Sex',
    neutered: 'Neutered',
    colour: 'Colour',
    microchip: 'Microchip number',
    save: 'Save',
    saved: 'Patient saved',
    male: 'Male',
    formCheck: 'Check the marked fields',
    required: 'Fill in this field',
    clients: 'Clients',
    cat: 'Cat',
    newPatient: 'New patient',
    newClient: 'New client',
  },
} as const

type Stub = {
  lookup?: (body: unknown) => Answer
  register?: (body: unknown) => Answer
  breed?: (body: unknown) => Answer
}

/** The API a receptionist's New visit talks to. */
function stubPractice({ lookup, register, breed }: Stub = {}, who = me) {
  const empty: PhoneLookupResult = { phone: '+994501234567', clients: [] }
  return stubApi(fetchMock, {
    'GET /api/me': () => Response.json(who),
    [`GET ${practicePath}/species`]: () => Response.json(species),
    [`POST ${practicePath}/clients/lookup`]: lookup ?? (() => Response.json(empty)),
    [`PUT ${practicePath}/registrations`]:
      register ??
      ((body) => {
        const sent = body as { client: { id: string }; patient: { id: string } }
        return Response.json({ clientId: sent.client.id, patientId: sent.patient.id })
      }),
    [`PUT ${practicePath}/breeds/*`]: breed ?? (() => problemAnswer(500, 'Internal server error')),
  })
}

/** The location header each practice request carried, as the API reads it. */
function locationHeaders(): (string | null)[] {
  return fetchMock.mock.calls
    .map(([input]) => input)
    .filter(
      (input): input is Request => input instanceof Request && new URL(input.url).pathname.startsWith(practicePath),
    )
    .map((request) => request.headers.get('vetora-location'))
}

async function openNewVisit(language: keyof typeof words = 'az') {
  renderApp('/visits/new')
  return screen.findByRole('heading', { level: 1, name: words[language].title })
}

async function searchPhone(phone: string, language: keyof typeof words = 'az') {
  const user = userEvent.setup()
  await user.type(screen.getByRole('textbox', { name: words[language].phone }), phone)
  await user.click(screen.getByRole('button', { name: words[language].search }))
}

/** The client fields of an unknown number, filled in Azerbaijani. */
async function fillClient(section: HTMLElement) {
  const user = userEvent.setup()
  await user.type(within(section).getByRole('textbox', { name: 'Ad' }), 'Rəşad')
  await user.type(within(section).getByRole('textbox', { name: 'Soyad' }), 'Əliyev')
  await user.type(within(section).getByRole('textbox', { name: 'Ata adı' }), 'Kamal oğlu')
}

/** The patient fields, filled in Azerbaijani: a male dog, neutered, black, with a microchip. */
async function fillPatient(section: HTMLElement) {
  const user = userEvent.setup()
  await user.type(within(section).getByRole('textbox', { name: 'Ad' }), 'Bəbir')
  await user.selectOptions(within(section).getByRole('combobox', { name: 'Növ' }), dog)
  await user.click(within(section).getByRole('radio', { name: 'Erkək' }))
  await user.click(within(section).getByRole('radio', { name: 'Bəli' }))
  await user.type(within(section).getByRole('textbox', { name: 'Rəng' }), 'Qara')
  await user.type(within(section).getByRole('textbox', { name: 'Mikroçip nömrəsi' }), '643094100123456')
}

const section = (name: string) => screen.getByRole('region', { name })

describe('New visit: find or register the client and the pet (#21, seam 3)', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    localStorage.clear()
    setLanguage('az')
    dismissToast()
  })

  it("is Visits today's primary action, which a groomer does not see (story 72)", async () => {
    stubPractice()
    const { router } = renderApp('/')

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Yeni qəbul' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Yeni qəbul' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/visits/new')
  })

  it('shows no New visit to a groomer', async () => {
    stubPractice({}, meOf({ practice: { ...me.practice, roles: ['groomer'] } }))
    renderApp('/')

    expect(await screen.findByRole('heading', { level: 1, name: 'Bugünkü qəbullar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Yeni qəbul' })).toBeNull()
  })

  it('opens the client and pet fields for an unknown phone; Save registers both with new ids at the default location, shows the toast and returns to Visits today (stories 23 to 25)', async () => {
    const asked = stubPractice()
    const { router } = renderApp('/visits/new')
    await screen.findByRole('heading', { level: 1, name: 'Yeni qəbul' })

    await searchPhone('050 123 45 67')
    await fillClient(await screen.findByRole('region', { name: 'Müştəri' }))
    await fillPatient(section('Pasiyent'))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Yadda saxla' }))

    expect(await screen.findByText('Pasiyent yadda saxlanıldı')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    expect(asked.find((request) => request.path === `${practicePath}/clients/lookup`)?.body).toEqual({
      phone: '050 123 45 67',
    })
    const registration = asked.find((request) => request.path === `${practicePath}/registrations`)
    expect(registration?.method).toBe('PUT')
    expect(registration?.body).toEqual({
      client: {
        type: 'new',
        id: expect.stringMatching(/^[0-9a-f-]{8}-[0-9a-f]{4}-7/),
        firstName: 'Rəşad',
        lastName: 'Əliyev',
        patronymic: 'Kamal oğlu',
        phone: '050 123 45 67',
        preferredLanguage: 'az',
      },
      patient: {
        type: 'new',
        id: expect.stringMatching(/^[0-9a-f-]{8}-[0-9a-f]{4}-7/),
        name: 'Bəbir',
        speciesId: dog,
        breedId: null,
        sex: 'male',
        birthDate: null,
        birthDateIsEstimate: false,
        isNeutered: true,
        colour: 'Qara',
        microchipNumber: '643094100123456',
      },
    })
    expect(locationHeaders().every((location) => location === me.locations[0]?.id)).toBe(true)
    expect(locationHeaders().length).toBeGreaterThanOrEqual(3)
  })

  it("shows a known phone's client with their patients; New patient registers another pet for that client", async () => {
    const asked = stubPractice({
      lookup: () => Response.json({ phone: '+994501234567', clients: [aysel] } satisfies PhoneLookupResult),
    })
    await openNewVisit()

    await searchPhone('+994 50 123 45 67')

    const found = await screen.findByRole('region', { name: 'Müştərilər' })
    expect(within(found).getByText('Məmmədova Aysel')).toBeInTheDocument()
    expect(within(found).getByText('Şəkər')).toBeInTheDocument()
    expect(within(found).getByText('Pişik')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Müştəri' })).toBeNull()

    await userEvent.setup().click(within(found).getByRole('button', { name: 'Yeni pasiyent' }))
    await fillPatient(await screen.findByRole('region', { name: 'Pasiyent' }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Yadda saxla' }))

    expect(await screen.findByText('Pasiyent yadda saxlanıldı')).toBeInTheDocument()
    const registration = asked.find((request) => request.path === `${practicePath}/registrations`)
    expect(registration?.body).toMatchObject({ client: { type: 'existing', id: aysel.id }, patient: { name: 'Bəbir' } })
  })

  it('warns, without blocking, when a new client is entered on a number another client has (story 26)', async () => {
    const asked = stubPractice({
      lookup: () => Response.json({ phone: '+994501234567', clients: [aysel] } satisfies PhoneLookupResult),
    })
    await openNewVisit()
    await searchPhone('0501234567')

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Yeni müştəri' }))

    expect(await screen.findByText('Bu telefon nömrəsi başqa müştəridə qeyd olunub')).toBeInTheDocument()
    await fillClient(section('Müştəri'))
    await fillPatient(section('Pasiyent'))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Yadda saxla' }))

    expect(await screen.findByText('Pasiyent yadda saxlanıldı')).toBeInTheDocument()
    const registration = asked.find((request) => request.path === `${practicePath}/registrations`)
    expect(registration?.body).toMatchObject({ client: { type: 'new', phone: '0501234567', lastName: 'Əliyev' } })
  })

  it('refuses blank required fields and a phone that is not one, and sends nothing', async () => {
    const asked = stubPractice()
    await openNewVisit()

    await searchPhone('12')
    expect(await screen.findByText('Nömrəni +994 50 123 45 67 kimi daxil edin')).toBeInTheDocument()
    expect(asked.some((request) => request.path.endsWith('/clients/lookup'))).toBe(false)

    await userEvent.setup().clear(screen.getByRole('textbox', { name: 'Telefon' }))
    await searchPhone('050 123 45 67')
    await screen.findByRole('region', { name: 'Müştəri' })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Yadda saxla' }))

    expect(await screen.findByText('İşarələnmiş sahələri yoxlayın')).toBeInTheDocument()
    const client = section('Müştəri')
    const patient = section('Pasiyent')
    expect(within(client).getAllByText('Bu sahəni doldurun')).toHaveLength(2)
    expect(within(patient).getByText('Pasiyentin adını daxil edin')).toBeInTheDocument()
    expect(within(patient).getAllByText('Bu sahəni doldurun')).toHaveLength(2)
    expect(asked.some((request) => request.path.endsWith('/registrations'))).toBe(false)
  })

  it('adds a breed inline in the language of the screen and saves the patient with it', async () => {
    const asked = stubPractice({
      breed: (body) => {
        const { speciesId, name } = body as { speciesId: string; name: string }
        return Response.json(
          { id: '019a3f00-0000-7000-8000-0000000000b9', speciesId, name: { az: name, ru: null, en: null } },
          {
            status: 201,
          },
        )
      },
    })
    await openNewVisit()
    await searchPhone('050 123 45 67')
    await fillClient(await screen.findByRole('region', { name: 'Müştəri' }))
    await fillPatient(section('Pasiyent'))
    const user = userEvent.setup()

    await user.click(within(section('Pasiyent')).getByRole('button', { name: 'Cins əlavə et' }))
    await user.type(within(section('Pasiyent')).getByRole('textbox', { name: 'Cins' }), 'Qafqaz çoban iti')
    await user.click(within(section('Pasiyent')).getByRole('button', { name: 'Əlavə et' }))

    await waitFor(() => expect(asked.some((request) => request.path.includes('/breeds/'))).toBe(true))
    const added = asked.find((request) => request.path.includes('/breeds/'))
    expect(added?.body).toEqual({ speciesId: dog, language: 'az', name: 'Qafqaz çoban iti' })
    await user.click(screen.getByRole('button', { name: 'Yadda saxla' }))
    expect(await screen.findByText('Pasiyent yadda saxlanıldı')).toBeInTheDocument()
    const registration = asked.find((request) => request.path === `${practicePath}/registrations`)
    expect(registration?.body).toMatchObject({ patient: { breedId: '019a3f00-0000-7000-8000-0000000000b9' } })
  })

  it("marks the microchip when it is another patient's, and keeps what was typed", async () => {
    stubPractice({
      register: () =>
        Response.json(
          {
            type: 'about:blank',
            title: "The microchip is another patient's",
            status: 409,
            errors: [{ path: ['patient', 'microchipNumber'], code: 'taken', message: 'Recorded for another patient' }],
          },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
    })
    const { router } = renderApp('/visits/new')
    await screen.findByRole('heading', { level: 1, name: 'Yeni qəbul' })
    await searchPhone('050 123 45 67')
    await fillClient(await screen.findByRole('region', { name: 'Müştəri' }))
    await fillPatient(section('Pasiyent'))

    await userEvent.setup().click(screen.getByRole('button', { name: 'Yadda saxla' }))

    expect(await screen.findByText('Bu mikroçip başqa pasiyentdə qeyd olunub')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/visits/new')
    expect(within(section('Müştəri')).getByRole('textbox', { name: 'Soyad' })).toHaveValue('Əliyev')
  })

  it('says the changes were not saved when the API fails, and keeps what was typed', async () => {
    stubPractice({ register: () => problemAnswer(500, 'Internal server error') })
    await openNewVisit()
    await searchPhone('050 123 45 67')
    await fillClient(await screen.findByRole('region', { name: 'Müştəri' }))
    await fillPatient(section('Pasiyent'))

    await userEvent.setup().click(screen.getByRole('button', { name: 'Yadda saxla' }))

    expect(await screen.findByText('Dəyişiklikləri yadda saxlamaq mümkün olmadı')).toBeInTheDocument()
    expect(within(section('Pasiyent')).getByRole('textbox', { name: 'Ad' })).toHaveValue('Bəbir')
  })

  it.each(languages)('speaks %s on every field of an unknown phone, with no axe violations', async (language) => {
    stubPractice({}, meOf({ language }))
    setLanguage(language)
    const expected = words[language]
    await openNewVisit(language)

    await searchPhone('050 123 45 67', language)

    const client = await screen.findByRole('region', { name: expected.client })
    for (const label of [expected.firstName, expected.lastName, expected.patronymic]) {
      expect(within(client).getByRole('textbox', { name: label })).toBeInTheDocument()
    }
    expect(within(client).getByRole('combobox', { name: expected.preferredLanguage })).toHaveValue(language)
    const patient = section(expected.patient)
    expect(within(patient).getByRole('textbox', { name: expected.patientName })).toBeInTheDocument()
    expect(within(patient).getByRole('combobox', { name: expected.species })).toBeInTheDocument()
    expect(within(patient).getByRole('combobox', { name: expected.breed })).toBeInTheDocument()
    expect(within(patient).getByRole('group', { name: expected.sex })).toBeInTheDocument()
    expect(within(patient).getByRole('group', { name: expected.neutered })).toBeInTheDocument()
    expect(within(patient).getByRole('textbox', { name: expected.colour })).toBeInTheDocument()
    expect(within(patient).getByRole('textbox', { name: expected.microchip })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: expected.save })).toBeInTheDocument()
    expect(violationsOf(await axe(document.body, axeOptions))).toEqual([])

    // Blank required fields are refused in the same language, and the page stays accessible with its errors showing.
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: expected.save }))
    expect(await screen.findByText(expected.formCheck)).toBeInTheDocument()
    expect(within(client).getAllByText(expected.required)).toHaveLength(2)
    expect(violationsOf(await axe(document.body, axeOptions))).toEqual([])

    // Filled in, Save registers and confirms in the same language.
    await user.type(within(client).getByRole('textbox', { name: expected.firstName }), 'Rəşad')
    await user.type(within(client).getByRole('textbox', { name: expected.lastName }), 'Əliyev')
    await user.type(within(patient).getByRole('textbox', { name: expected.patientName }), 'Bəbir')
    await user.selectOptions(within(patient).getByRole('combobox', { name: expected.species }), dog)
    await user.click(within(patient).getByRole('radio', { name: expected.male }))
    await user.click(screen.getByRole('button', { name: expected.save }))
    expect(await screen.findByText(expected.saved)).toBeInTheDocument()
  })

  it.each(languages)(
    "shows a known phone's client with their patients in %s, with no axe violations",
    async (language) => {
      stubPractice(
        { lookup: () => Response.json({ phone: '+994501234567', clients: [aysel] } satisfies PhoneLookupResult) },
        meOf({ language }),
      )
      setLanguage(language)
      const expected = words[language]
      await openNewVisit(language)

      await searchPhone('050 123 45 67', language)

      const found = await screen.findByRole('region', { name: expected.clients })
      expect(within(found).getByText('Məmmədova Aysel')).toBeInTheDocument()
      expect(within(found).getByText('Şəkər')).toBeInTheDocument()
      expect(within(found).getByText(expected.cat)).toBeInTheDocument()
      expect(within(found).getByRole('button', { name: expected.newPatient })).toBeInTheDocument()
      expect(within(found).getByRole('button', { name: expected.newClient })).toBeInTheDocument()
      expect(violationsOf(await axe(document.body, axeOptions))).toEqual([])
    },
  )
})
