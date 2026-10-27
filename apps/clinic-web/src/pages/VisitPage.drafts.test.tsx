import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Visit, VisitNote } from '@vetora/contracts'
import { languages } from '@vetora/i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { type KeptDraft, keepDraft, keptDraft } from '../drafts'
import { setLanguage } from '../i18n'
import { type Answer, axeOptions, meOf, problemAnswer, renderApp, stubApi, violationsOf } from '../test-support'

/**
 * The draft note that survives a dropped connection (#24; spec #18, seam 3): the copy kept in IndexedDB (in memory
 * here), the save rhythm on a fake clock, the conflict that keeps the text, the offer on reopening, and the copies
 * at sign out and at a session's end.
 */

const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', mock)
  return mock
})

const me = meOf()
const colleague = meOf({ id: '019a3f00-0000-7000-8000-00000000c011', displayName: 'Rəşad Quliyev' })
const visitId = '019a3f00-0000-7000-8000-0000000000f1'
const otherVisitId = '019a3f00-0000-7000-8000-0000000000f2'
const visitPath = `/api/p/${me.practice.id}/visits/${visitId}`
const patientId = '019a3f00-0000-7000-8000-0000000000e1'

/** The visit's vital signs (#23), which the page reads beside the note: none recorded, no weight before. */
const noReadings = {
  [`GET ${visitPath}/observations`]: () => Response.json({ observations: [] }),
  [`GET /api/p/${me.practice.id}/patients/${patientId}/last-weight`]: () => Response.json({ lastWeight: null }),
  // The invoice card (#25), with no invoice yet.
  [`GET ${visitPath}/invoice`]: () => Response.json({ invoice: null }),
  [`GET /api/p/${me.practice.id}/services`]: () => Response.json({ services: [] }),
}

const emptyNote: VisitNote = {
  reasonForVisit: '',
  anamnesis: '',
  examination: '',
  diagnosis: '',
  treatment: '',
  recommendations: '',
}

/** A draft visit of Şəkər, started by Leyla, its note as the server holds it at `version`. */
const draftOf = (note: VisitNote = emptyNote, version = 1): Visit => ({
  id: visitId,
  status: 'draft',
  version,
  startedAt: '2026-10-27T05:05:00.000Z',
  finalisedAt: null,
  veterinarian: { id: me.id, displayName: 'Leyla Həsənova' },
  patient: {
    id: patientId,
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
    balance: null,
  },
  note,
})

/** The words these tests read, from the design system's messages and glossary through packages/i18n. */
const words = {
  az: {
    sections: ['Müraciət səbəbi', 'Anamnez', 'Müayinə', 'Diaqnoz', 'Müalicə', 'Tövsiyələr'],
    saved: 'Yadda saxlanıldı',
    notSaved: 'Yadda saxlanılmayıb',
    offline: 'Bağlantı yoxdur. Mətn bu kompüterdə qalıb',
    noConnection: 'Bağlantı yoxdur',
    complete: 'Qəbulu tamamla',
    conflict: 'Siz redaktə edərkən başqa əməkdaş qeydi dəyişib',
    loadLatest: 'Son versiyanı yüklə',
    kept: 'Bu kompüterdə qalan mətn',
    keptBody: 'Bu mətn hələ qeydə yazılmayıb. Onu qeydin yerinə yazmaq üçün bərpa edin və ya yadda saxlamayın.',
    restore: 'Bərpa et',
    discard: 'Yadda saxlama',
    visitsToday: 'Bugünkü qəbullar',
  },
  ru: {
    sections: ['Причина обращения', 'Анамнез', 'Осмотр', 'Диагноз', 'Лечение', 'Рекомендации'],
    saved: 'Сохранено',
    notSaved: 'Не сохранено',
    offline: 'Нет подключения. Текст остался на этом компьютере',
    noConnection: 'Нет подключения',
    complete: 'Завершить приём',
    conflict: 'Пока вы редактировали, другой сотрудник изменил протокол',
    loadLatest: 'Загрузить последнюю версию',
    kept: 'Текст, оставшийся на этом компьютере',
    keptBody:
      'Этого текста ещё нет в протоколе. Восстановите его, чтобы он заменил текст протокола, или не сохраняйте его.',
    restore: 'Восстановить',
    discard: 'Не сохранять',
    visitsToday: 'Приёмы сегодня',
  },
  en: {
    sections: ['Reason for visit', 'History', 'Examination', 'Diagnosis', 'Treatment', 'Recommendations'],
    saved: 'Saved',
    notSaved: 'Not saved',
    offline: 'No connection. Text kept on this computer',
    noConnection: 'No connection',
    complete: 'Complete visit',
    conflict: 'Someone else changed this note while you were editing',
    loadLatest: 'Load latest version',
    kept: 'Text kept on this computer',
    keptBody: 'This text is not in the note yet. Restore it to save it in place of the note, or discard it.',
    restore: 'Restore',
    discard: 'Discard',
    visitsToday: 'Visits today',
  },
} as const

/**
 * The API as a server would hold the visit: the note and its version, a save against the version taking it (412
 * otherwise), the person whose session it is, and whether a connection or a session exists at all.
 */
function stubServer(initial: { note?: VisitNote; version?: number; who?: typeof me } = {}) {
  const server = {
    note: initial.note ?? emptyNote,
    version: initial.version ?? 1,
    who: initial.who ?? me,
    online: true,
    signedIn: true,
    /** When each save reached the server, by the page's clock, and what it carried. */
    saves: [] as { at: number; ifMatch: string | null; note: VisitNote }[],
  }
  const signedIn = (answer: () => Answer) => (): Answer =>
    server.signedIn ? answer() : problemAnswer(401, 'Not signed in')
  const asked = stubApi(fetchMock, {
    'GET /api/me': signedIn(() => Response.json(server.who)),
    'POST /api/auth/sign-in/username': () => {
      server.signedIn = true
      return new Response(null, { status: 204 })
    },
    'POST /api/auth/sign-out': () => {
      server.signedIn = false
      return new Response(null, { status: 204 })
    },
    [`GET /api/p/${me.practice.id}/visits`]: signedIn(() => Response.json({ day: '2026-10-27', visits: [] })),
    [`GET ${visitPath}`]: signedIn(() => Response.json(draftOf(server.note, server.version))),
    ...noReadings,
  })
  // The note's save is answered here, since it reads the If-Match header, which a route is not handed.
  const routed = fetchMock.getMockImplementation()
  if (!routed) throw new Error('stubApi answers through the mock implementation')
  fetchMock.mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : new Request(String(input), init)
    if (request.method !== 'PUT' || new URL(request.url).pathname !== `${visitPath}/note`) return routed(input, init)
    asked.push({ method: 'PUT', path: `${visitPath}/note`, body: await request.clone().json() })
    if (!server.online) throw new TypeError('Failed to fetch')
    if (!server.signedIn) return problemAnswer(401, 'Not signed in')
    const ifMatch = request.headers.get('if-match')
    if (ifMatch !== `"${server.version}"`) return problemAnswer(412, 'The visit changed since it was read')
    server.note = (await request.json()) as VisitNote
    server.version += 1
    server.saves.push({ at: Date.now(), ifMatch, note: server.note })
    return Response.json({ version: server.version })
  })
  return { server, asked }
}

const kept = (personId: string, visit: string, note: Partial<VisitNote>, baseVersion = 1): KeptDraft => ({
  personId,
  visitId: visit,
  note: { ...emptyNote, ...note },
  baseVersion,
  keptAt: '2026-10-27T05:30:00.000Z',
})

async function openVisit(language: keyof typeof words = 'az') {
  const app = renderApp(`/visits/${visitId}`)
  await screen.findByRole('heading', { level: 1, name: 'Şəkər' })
  return { ...app, words: words[language] }
}

const sectionField = (label: string) => screen.getByRole('textbox', { name: label })

/** Let `ms` pass on the page's fake clock, with everything it sets off. */
const pass = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

/** From here on the page's timers and clock are fake; IndexedDB's own scheduling (setImmediate) stays real. */
function useFakeClock() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
}

/**
 * Type `text` at the end of a section as one change. On the fake clock the tests type through `fireEvent`: user-event
 * and Testing Library's async wrapper wait on a `setTimeout` that only a Jest clock would advance.
 */
const typeInto = (field: HTMLElement, text: string) =>
  fireEvent.change(field, { target: { value: `${(field as HTMLTextAreaElement).value}${text}` } })

describe('the draft note survives a dropped connection (#24, seam 3)', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    localStorage.clear()
    setLanguage('az')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('with no connection the line says the text is kept on this computer, IndexedDB holds it, and the save goes through when the connection returns', async () => {
    const { server } = stubServer()
    server.online = false
    const { words } = await openVisit()
    useFakeClock()

    typeInto(sectionField(words.sections[0]), 'Limping')
    await pass(4_000)

    expect(screen.getByText(words.offline)).toBeInTheDocument()
    expect(sectionField(words.sections[0])).toHaveValue('Limping')
    await vi.waitFor(async () =>
      expect((await keptDraft(me.id, visitId))?.note).toEqual({ ...emptyNote, reasonForVisit: 'Limping' }),
    )
    expect(server.saves).toEqual([])

    // Typing goes on while the connection is away.
    typeInto(sectionField(words.sections[2]), 'Quiet')
    await pass(2_000)
    await vi.waitFor(async () =>
      expect((await keptDraft(me.id, visitId))?.note).toEqual({
        ...emptyNote,
        reasonForVisit: 'Limping',
        examination: 'Quiet',
      }),
    )

    server.online = true
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })

    await vi.waitFor(() =>
      expect(server.saves.map((save) => save.note)).toEqual([
        { ...emptyNote, reasonForVisit: 'Limping', examination: 'Quiet' },
      ]),
    )
    await vi.waitFor(() => expect(screen.getByText(words.saved)).toBeInTheDocument())
    // The server holds the same text, so the copy is gone.
    await vi.waitFor(async () => expect(await keptDraft(me.id, visitId)).toBeUndefined())
  })

  it('the line says the text is kept as soon as the browser loses the connection, before a save finds out', async () => {
    const { server } = stubServer()
    const { words } = await openVisit()
    useFakeClock()
    typeInto(sectionField(words.sections[0]), 'Limping')
    await pass(4_000)
    await vi.waitFor(() => expect(screen.getByText(words.saved)).toBeInTheDocument())

    // Within 30 seconds of that save the next one waits, so only the browser can tell.
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    server.online = false
    typeInto(sectionField(words.sections[0]), ', left fore')
    expect(screen.getByText(words.offline)).toBeInTheDocument()
    typeInto(sectionField(words.sections[2]), 'Quiet')
    await act(async () => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(screen.getByText(words.offline)).toBeInTheDocument()
    expect(server.saves).toHaveLength(1)

    onLine.mockReturnValue(true)
    server.online = true
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    // The line says again what the last save did, until the next one.
    expect(screen.queryByText(words.offline)).toBeNull()
    expect(screen.getByText(words.saved)).toBeInTheDocument()
    await pass(30_000)
    await vi.waitFor(() => expect(server.saves).toHaveLength(2))
    expect(server.saves.at(-1)?.note).toEqual({
      ...emptyNote,
      reasonForVisit: 'Limping, left fore',
      examination: 'Quiet',
    })
  })

  it.each(languages)(
    'in %s: with no connection the line says the text is kept, and Complete visit says there is no connection; axe finds no violation',
    async (language) => {
      const { server } = stubServer({ who: meOf({ language }) })
      server.online = false
      setLanguage(language)
      const { words } = await openVisit(language)
      const user = userEvent.setup()

      await user.type(sectionField(words.sections[0]), 'Limping')
      await user.tab()

      expect(await screen.findByText(words.offline)).toBeInTheDocument()
      expect(violationsOf(await axe(document.body, axeOptions))).toEqual([])

      await user.click(screen.getByRole('button', { name: words.complete }))

      const problem = await screen.findByRole('alert')
      expect(within(problem).getByText(words.noConnection)).toBeInTheDocument()
      expect(sectionField(words.sections[0])).toHaveValue('Limping')
      expect(server.saves).toEqual([])
    },
  )

  it('a gateway that cannot reach the API counts as no connection, and the text is kept', async () => {
    stubApi(fetchMock, {
      'GET /api/me': () => Response.json(me),
      [`GET ${visitPath}`]: () => Response.json(draftOf()),
      ...noReadings,
      [`PUT ${visitPath}/note`]: () => problemAnswer(503, 'Service unavailable'),
    })
    const { words } = await openVisit()
    const user = userEvent.setup()

    await user.type(sectionField(words.sections[0]), 'Limping')
    await user.tab()

    expect(await screen.findByText(words.offline)).toBeInTheDocument()
    await waitFor(async () => expect((await keptDraft(me.id, visitId))?.note.reasonForVisit).toBe('Limping'))
  })

  it('a save that found no connection is tried again every 30 seconds, without waiting for the browser to notice', async () => {
    const { server } = stubServer()
    server.online = false
    const { words } = await openVisit()
    useFakeClock()
    typeInto(sectionField(words.sections[0]), 'Limping')
    await pass(4_000)
    expect(screen.getByText(words.offline)).toBeInTheDocument()

    server.online = true
    await pass(30_000)

    await vi.waitFor(() => expect(server.saves.map((save) => save.note.reasonForVisit)).toEqual(['Limping']))
    await vi.waitFor(() => expect(screen.getByText(words.saved)).toBeInTheDocument())
  })

  it('saves once the text has been still a few seconds, at most once every 30 seconds while the vet types without pause, and at once on leaving the page', async () => {
    const { server } = stubServer()
    const { words, router } = await openVisit()
    useFakeClock()
    const field = sectionField(words.sections[1])

    // Still for 2.5 seconds is not yet still; at 3 seconds it is.
    typeInto(field, 'Two days')
    await pass(2_500)
    expect(server.saves).toEqual([])
    await pass(1_000)
    await vi.waitFor(() => expect(server.saves.map((save) => save.note.anamnesis)).toEqual(['Two days']))

    // Seventy seconds of typing without a pause of a second.
    for (let second = 0; second < 70; second += 1) {
      typeInto(field, 'a')
      await pass(1_000)
    }
    expect(server.saves.length).toBeGreaterThanOrEqual(3)
    for (const [index, save] of server.saves.entries()) {
      if (index > 0) expect(save.at - (server.saves[index - 1]?.at ?? 0)).toBeGreaterThanOrEqual(30_000)
    }

    // Once the vet stops, what is left is saved within 30 seconds of the last save.
    await pass(30_000)
    await vi.waitFor(() => expect(server.saves.at(-1)?.note.anamnesis).toBe(`Two days${'a'.repeat(70)}`))

    // Leaving the page saves what is still unsaved, without waiting for the 30 seconds.
    const before = server.saves.length
    typeInto(field, '!')
    fireEvent.click(screen.getAllByRole('link', { name: words.visitsToday })[0] as HTMLElement)
    await vi.waitFor(() => expect(server.saves).toHaveLength(before + 1))
    expect(router.state.location.pathname).toBe('/')
    expect(server.saves.at(-1)?.note.anamnesis).toBe(`Two days${'a'.repeat(70)}!`)
    expect((server.saves.at(-1)?.at ?? 0) - (server.saves.at(-2)?.at ?? 0)).toBeLessThan(30_000)
  })

  it('leaving a section saves at once when nothing was saved for 30 seconds, and otherwise once the 30 seconds are up', async () => {
    const { server } = stubServer()
    const { words } = await openVisit()
    useFakeClock()

    typeInto(sectionField(words.sections[0]), 'Limping')
    fireEvent.blur(sectionField(words.sections[0]))
    await pass(0)
    await vi.waitFor(() => expect(server.saves).toHaveLength(1))

    typeInto(sectionField(words.sections[1]), 'Two days')
    fireEvent.blur(sectionField(words.sections[1]))
    await pass(10_000)
    expect(server.saves).toHaveLength(1)
    await pass(20_000)
    await vi.waitFor(() => expect(server.saves).toHaveLength(2))
    expect(server.saves.map((save) => save.note)).toEqual([
      { ...emptyNote, reasonForVisit: 'Limping' },
      { ...emptyNote, reasonForVisit: 'Limping', anamnesis: 'Two days' },
    ])
  })

  it.each(languages)(
    'in %s: reopening a visit whose kept copy differs from the saved note offers it back; Restore saves it over the note',
    async (language) => {
      const { server } = stubServer({ who: meOf({ language }) })
      await keepDraft(kept(me.id, visitId, { reasonForVisit: 'Limping', anamnesis: 'Two days' }))
      setLanguage(language)
      const { words } = await openVisit(language)

      const offer = await screen.findByRole('region', { name: words.kept })
      expect(within(offer).getByText(words.keptBody)).toBeInTheDocument()
      expect(within(offer).getByText('Limping')).toBeInTheDocument()
      expect(within(offer).getByText('Two days')).toBeInTheDocument()
      // The note's sections wait for the choice; the vital signs, readings of their own, stay fields.
      for (const label of words.sections) expect(screen.queryByRole('textbox', { name: label })).toBeNull()
      expect(violationsOf(await axe(document.body, axeOptions))).toEqual([])

      await userEvent.setup().click(within(offer).getByRole('button', { name: words.restore }))

      await waitFor(() => expect(screen.getByText(words.saved)).toBeInTheDocument())
      expect(screen.queryByRole('region', { name: words.kept })).toBeNull()
      expect(sectionField(words.sections[0])).toHaveValue('Limping')
      expect(sectionField(words.sections[1])).toHaveValue('Two days')
      expect(server.saves).toEqual([
        {
          at: expect.any(Number),
          ifMatch: '"1"',
          note: { ...emptyNote, reasonForVisit: 'Limping', anamnesis: 'Two days' },
        },
      ])
      await waitFor(async () => expect(await keptDraft(me.id, visitId)).toBeUndefined())
    },
  )

  it('Discard deletes the kept copy and leaves the saved note as it is', async () => {
    const { server } = stubServer({ note: { ...emptyNote, reasonForVisit: 'Vaccination' }, version: 4 })
    await keepDraft(kept(me.id, visitId, { reasonForVisit: 'Limping' }, 3))
    const { words } = await openVisit()

    const offer = await screen.findByRole('region', { name: words.kept })
    await userEvent.setup().click(within(offer).getByRole('button', { name: words.discard }))

    expect(await screen.findByRole('textbox', { name: words.sections[0] })).toHaveValue('Vaccination')
    expect(screen.queryByRole('region', { name: words.kept })).toBeNull()
    expect(server.saves).toEqual([])
    expect(await keptDraft(me.id, visitId)).toBeUndefined()
  })

  it('a kept copy equal to the saved note is deleted without a word', async () => {
    stubServer({ note: { ...emptyNote, reasonForVisit: 'Limping' }, version: 2 })
    await keepDraft(kept(me.id, visitId, { reasonForVisit: 'Limping' }))
    const { words } = await openVisit()

    expect(sectionField(words.sections[0])).toHaveValue('Limping')
    expect(screen.queryByRole('region', { name: words.kept })).toBeNull()
    await waitFor(async () => expect(await keptDraft(me.id, visitId)).toBeUndefined())
  })

  it.each(languages)(
    'in %s: a save refused as stale keeps the text and says someone else changed the note; loading the latest and restoring saves the text with the new version',
    async (language) => {
      const { server } = stubServer({ who: meOf({ language }) })
      setLanguage(language)
      const { words } = await openVisit(language)
      const user = userEvent.setup()
      // A colleague saves the same note first.
      server.note = { ...emptyNote, reasonForVisit: 'Vaccination', examination: 'Healthy' }
      server.version = 2

      await user.type(sectionField(words.sections[0]), 'Limping')
      await user.tab()

      const conflict = await screen.findByRole('alert')
      expect(within(conflict).getByText(words.conflict)).toBeInTheDocument()
      expect(screen.getByText(words.notSaved)).toBeInTheDocument()
      expect(sectionField(words.sections[0])).toHaveValue('Limping')
      expect(violationsOf(await axe(document.body, axeOptions))).toEqual([])

      // Saving stops, and the text goes on being kept on this computer.
      await user.type(sectionField(words.sections[0]), ', left fore')
      await user.tab()
      await waitFor(async () =>
        expect((await keptDraft(me.id, visitId))?.note.reasonForVisit).toBe('Limping, left fore'),
      )
      expect(server.saves).toEqual([])

      await user.click(within(conflict).getByRole('button', { name: words.loadLatest }))

      // The colleague's text is the note; the vet's own is offered beside it.
      const offer = await screen.findByRole('region', { name: words.kept })
      expect(within(offer).getByText('Limping, left fore')).toBeInTheDocument()
      expect(screen.getByText('Vaccination')).toBeInTheDocument()
      expect(screen.getByText('Healthy')).toBeInTheDocument()
      expect(screen.queryByRole('alert')).toBeNull()

      await user.click(within(offer).getByRole('button', { name: words.restore }))

      await waitFor(() => expect(screen.getByText(words.saved)).toBeInTheDocument())
      expect(sectionField(words.sections[0])).toHaveValue('Limping, left fore')
      expect(server.saves).toEqual([
        { at: expect.any(Number), ifMatch: '"2"', note: { ...emptyNote, reasonForVisit: 'Limping, left fore' } },
      ])
    },
  )

  it('signing out deletes every copy the person kept on this computer, and only theirs', async () => {
    stubServer()
    await keepDraft(kept(me.id, visitId, { reasonForVisit: 'Limping' }))
    await keepDraft(kept(me.id, otherVisitId, { reasonForVisit: 'Vaccination' }))
    await keepDraft(kept(colleague.id, visitId, { reasonForVisit: 'Itching' }))
    renderApp('/profile')

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Çıx' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Daxil ol' })).toBeInTheDocument()
    expect(await keptDraft(me.id, visitId)).toBeUndefined()
    expect(await keptDraft(me.id, otherVisitId)).toBeUndefined()
    expect((await keptDraft(colleague.id, visitId))?.note.reasonForVisit).toBe('Itching')
  })

  it('a session that ends on its own keeps the copy, and the same person gets it back after signing in again', async () => {
    const { server } = stubServer()
    localStorage.setItem('vetora.clinicCode', 'alfa')
    const { words, router } = await openVisit()
    const user = userEvent.setup()
    server.signedIn = false

    await user.type(sectionField(words.sections[0]), 'Limping')
    await user.tab()

    expect(await screen.findByText('Sessiyanın vaxtı bitdi')).toBeInTheDocument()
    await waitFor(async () => expect((await keptDraft(me.id, visitId))?.note.reasonForVisit).toBe('Limping'))

    await user.type(screen.getByLabelText('İstifadəçi adı'), 'leyla')
    await user.type(screen.getByLabelText('Şifrə'), 'a long password')
    await user.click(screen.getByRole('button', { name: 'Daxil ol' }))
    await screen.findByRole('heading', { level: 1, name: words.visitsToday })
    await act(() => router.navigate({ to: '/visits/$visitId', params: { visitId } }))

    const offer = await screen.findByRole('region', { name: words.kept })
    expect(within(offer).getByText('Limping')).toBeInTheDocument()
  })

  it('another person signed in on the same computer is never offered the copy', async () => {
    stubServer({ who: colleague })
    await keepDraft(kept(me.id, visitId, { reasonForVisit: 'Limping' }))
    const { words } = await openVisit()

    expect(sectionField(words.sections[0])).toHaveValue('')
    expect(screen.queryByRole('region', { name: words.kept })).toBeNull()
    expect((await keptDraft(me.id, visitId))?.note.reasonForVisit).toBe('Limping')
  })

  it('with no storage on this computer (a private window, storage refused) the note is still saved to the server', async () => {
    // test-setup.ts gives the next test a working IndexedDB again.
    globalThis.indexedDB = {
      open: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    } as unknown as IDBFactory
    const { server } = stubServer()
    const { words } = await openVisit()
    const user = userEvent.setup()

    await user.type(sectionField(words.sections[0]), 'Limping')
    await user.tab()

    expect(await screen.findByText(words.saved)).toBeInTheDocument()
    expect(server.saves.map((save) => save.note.reasonForVisit)).toEqual(['Limping'])
    expect(screen.queryByRole('region', { name: words.kept })).toBeNull()
    expect(await keptDraft(me.id, visitId)).toBeUndefined()
  })
})
