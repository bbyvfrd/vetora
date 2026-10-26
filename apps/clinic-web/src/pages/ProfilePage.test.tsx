import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Me } from '@vetora/contracts'
import { languages } from '@vetora/i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { setLanguage } from '../i18n'
import { axeOptions, meOf, problemAnswer, renderApp, stubApi, violationsOf } from '../test-support'

const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', mock)
  return mock
})

/** The profile's words in each language. */
const words = {
  az: { title: 'Profil', clinic: 'Klinika', role: 'Rol', vet: 'Baytar həkim', language: 'Dil', signOut: 'Çıx' },
  ru: {
    title: 'Профиль',
    clinic: 'Клиника',
    role: 'Роль',
    vet: 'Ветеринарный врач',
    language: 'Язык',
    signOut: 'Выйти',
  },
  en: {
    title: 'Profile',
    clinic: 'Clinic',
    role: 'Role',
    vet: 'Veterinarian',
    language: 'Language',
    signOut: 'Sign out',
  },
} as const

/** A signed in vet whose saved language the API keeps, as the login does, and who can sign out. */
function stubAccount(initial: Me = meOf()) {
  const state = { signedIn: true, me: initial }
  const asked = stubApi(fetchMock, {
    'GET /api/me': () => (state.signedIn ? Response.json(state.me) : problemAnswer(401, 'Not signed in')),
    'PUT /api/me/language': (body) => {
      state.me = { ...state.me, language: (body as { language: Me['language'] }).language }
      return new Response(null, { status: 204 })
    },
    'POST /api/auth/sign-out': () => {
      state.signedIn = false
      return new Response(null, { status: 204 })
    },
  })
  return { state, asked }
}

/** From Visits today, through the rail's account entry, to the profile. */
async function openProfile() {
  const entry = await screen.findByRole('link', { name: /^Leyla Həsənova/ })
  await userEvent.setup().click(entry)
  return screen.findByRole('heading', { level: 1, name: 'Profil' })
}

describe("the profile the rail's account entry opens (spec #18, seam 3)", () => {
  beforeEach(() => {
    fetchMock.mockReset()
    localStorage.clear()
    setLanguage('az')
  })

  it('names the person, their clinic and their roles, from the account entry at the foot of the rail (story 11)', async () => {
    stubAccount(meOf({ practice: { ...meOf().practice, roles: ['manager', 'veterinarian'] } }))
    const { router } = renderApp('/')

    await openProfile()

    expect(router.state.location.pathname).toBe('/profile')
    const main = screen.getByRole('main')
    expect(within(main).getByText('Leyla Həsənova')).toBeInTheDocument()
    expect(within(main).getByText('Alfa Vet')).toBeInTheDocument()
    expect(within(main).getByText('Rəhbər, Baytar həkim')).toBeInTheDocument()
    expect(within(main).getByRole('combobox', { name: 'Dil' })).toHaveValue('az')
  })

  it('saves a new language to the login and speaks it at once, so the next /api/me, on any computer, answers with it (story 12)', async () => {
    const { state, asked } = stubAccount()
    renderApp('/')
    await openProfile()

    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Dil' }), 'ru')

    expect(await screen.findByRole('heading', { level: 1, name: 'Профиль' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Приёмы сегодня' })).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('ru')
    expect(asked.filter((request) => request.method === 'PUT')).toEqual([
      { method: 'PUT', path: '/api/me/language', body: { language: 'ru' } },
    ])
    expect(state.me.language).toBe('ru')
  })

  it('puts the language back when the API refuses to save it', async () => {
    const routes = stubApi(fetchMock, {
      'GET /api/me': () => Response.json(meOf()),
      'PUT /api/me/language': () => problemAnswer(400, 'Validation failed'),
    })
    renderApp('/')
    await openProfile()

    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Dil' }), 'en')

    await waitFor(() => expect(routes.some((request) => request.method === 'PUT')).toBe(true))
    expect(await screen.findByRole('heading', { level: 1, name: 'Profil' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Dil' })).toHaveValue('az')
    expect(document.documentElement.lang).toBe('az')
  })

  it('signs out at once: the session ends, and the sign in page shows with the clinic code still filled in (story 9)', async () => {
    localStorage.setItem('vetora.clinicCode', 'alfa')
    const { asked } = stubAccount()
    const { router, queryClient } = renderApp('/')
    await openProfile()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Çıx' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Daxil ol' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/sign-in')
    expect(asked.some((request) => request.method === 'POST' && request.path === '/api/auth/sign-out')).toBe(true)
    expect(screen.getByLabelText('Klinika kodu')).toHaveValue('alfa')
    expect(screen.queryByText('Sessiyanın vaxtı bitdi')).toBeNull()
    expect(queryClient.getQueryData(['me'])).toBeUndefined()
  })

  it.each(languages)('has no axe violations in %s', async (language) => {
    stubAccount(meOf({ language }))
    renderApp('/profile')

    const expected = words[language]
    expect(await screen.findByRole('heading', { level: 1, name: expected.title })).toBeInTheDocument()
    expect(screen.getByText(expected.vet)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: expected.language })).toHaveValue(language)
    expect(screen.getByRole('button', { name: expected.signOut })).toBeInTheDocument()
    expect(violationsOf(await axe(document.body, axeOptions))).toEqual([])
  })
})
