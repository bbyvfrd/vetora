import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type Language, languages } from '@vetora/i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { setLanguage } from '../i18n'
import { type Answer, axeOptions, meOf, problemAnswer, renderApp, stubApi, violationsOf } from '../test-support'

const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', mock)
  return mock
})

/** The sign in page's words in each language, from the design system glossary and messages through packages/i18n. */
const words = {
  az: {
    title: 'Daxil ol',
    code: 'Klinika kodu',
    username: 'İstifadəçi adı',
    password: 'Şifrə',
    submit: 'Daxil ol',
    forgot: 'Şifrəni unutmusunuz? Klinikanın rəhbərinə müraciət edin.',
    brand: 'Baytarlıq klinikaları üçün idarəetmə',
    language: 'Dil',
  },
  ru: {
    title: 'Вход',
    code: 'Код клиники',
    username: 'Имя пользователя',
    password: 'Пароль',
    submit: 'Войти',
    forgot: 'Забыли пароль? Обратитесь к руководителю клиники.',
    brand: 'Управление ветеринарной клиникой',
    language: 'Язык',
  },
  en: {
    title: 'Sign in',
    code: 'Clinic code',
    username: 'Username',
    password: 'Password',
    submit: 'Sign in',
    forgot: "Forgot your password? Ask the clinic's manager.",
    brand: 'Practice management for veterinary clinics',
    language: 'Language',
  },
} as const satisfies Record<Language, Record<string, string>>

const languageButton = { az: 'Azərbaycanca', ru: 'Русский', en: 'English' } as const

/** The API: sign in answers as `signInAnswer` says, and `/api/me` answers only once a sign in has worked. */
function stubSignIn(signInAnswer: () => Answer, me = meOf()) {
  const state = { signedIn: false }
  const asked = stubApi(fetchMock, {
    'POST /api/auth/sign-in/username': () => {
      const answer = signInAnswer()
      if (answer !== 'offline' && answer.status === 204) state.signedIn = true
      return answer
    },
    'GET /api/me': () => (state.signedIn ? Response.json(me) : problemAnswer(401, 'Not signed in')),
  })
  return { asked, state }
}

const signedIn = () => new Response(null, { status: 204 })
const refused = () => problemAnswer(401, 'Sign in failed')

async function fillIn(values: { code?: string; username?: string; password?: string }) {
  const user = userEvent.setup()
  if (values.code !== undefined) {
    await user.clear(screen.getByLabelText('Klinika kodu'))
    if (values.code) await user.type(screen.getByLabelText('Klinika kodu'), values.code)
  }
  if (values.username) await user.type(screen.getByLabelText('İstifadəçi adı'), values.username)
  if (values.password) await user.type(screen.getByLabelText('Şifrə'), values.password)
  await user.click(screen.getByRole('button', { name: 'Daxil ol' }))
}

describe('the sign in page (spec #18, seam 3: the page in a DOM through the real router)', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    localStorage.clear()
    setLanguage('az')
  })

  it.each(languages)(
    'shows the clinic code, the username, the password, the button, the forgotten password line and the language choice in %s, with no axe violation (stories 3 and 7)',
    async (language) => {
      stubSignIn(refused)
      renderApp('/sign-in')
      await screen.findByRole('heading', { level: 1, name: 'Daxil ol' })

      await userEvent.setup().click(screen.getByRole('button', { name: languageButton[language] }))

      const expected = words[language]
      expect(await screen.findByRole('heading', { level: 1, name: expected.title })).toBeInTheDocument()
      expect(screen.getByLabelText(expected.code)).toHaveAttribute('autocomplete', 'organization')
      expect(screen.getByLabelText(expected.username)).toHaveAttribute('autocomplete', 'username')
      expect(screen.getByLabelText(expected.password)).toHaveAttribute('type', 'password')
      expect(screen.getByRole('button', { name: expected.submit })).toHaveAttribute('type', 'submit')
      expect(screen.getByText(expected.forgot)).toBeInTheDocument()
      expect(screen.getByText(expected.brand)).toBeInTheDocument()
      const choice = screen.getByRole('group', { name: expected.language })
      expect(within(choice).getByRole('button', { name: languageButton[language] })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      // No "Keep me signed in", no email field, no reset link (the design system's SignInPage example, version 23).
      expect(screen.queryByRole('checkbox')).toBeNull()
      expect(screen.getAllByRole('textbox')).toHaveLength(2)
      expect(screen.queryByRole('link')).toBeNull()
      expect(document.documentElement.lang).toBe(language)
      expect(localStorage.getItem('vetora.language')).toBe(language)
      expect(violationsOf(await axe(document.body, axeOptions))).toEqual([])
    },
  )

  it('signs in with handle@code in lower case, remembers the clinic code on this computer, and lands on Visits today in the language of the login (stories 1, 2 and 12)', async () => {
    const { asked } = stubSignIn(signedIn, meOf({ language: 'ru' }))
    const { router } = renderApp('/sign-in')
    await screen.findByRole('heading', { level: 1, name: 'Daxil ol' })

    await fillIn({ code: ' Alfa ', username: 'Dr.Leyla', password: 'correct horse battery staple' })

    expect(await screen.findByRole('heading', { level: 1, name: 'Приёмы сегодня' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    expect(asked.find((request) => request.path === '/api/auth/sign-in/username')).toEqual({
      method: 'POST',
      path: '/api/auth/sign-in/username',
      body: { username: 'dr.leyla@alfa', password: 'correct horse battery staple' },
    })
    expect(localStorage.getItem('vetora.clinicCode')).toBe('alfa')
  })

  it('fills the clinic code in from the last successful sign in on this computer', async () => {
    localStorage.setItem('vetora.clinicCode', 'alfa')
    stubSignIn(refused)
    renderApp('/sign-in')

    expect(await screen.findByLabelText('Klinika kodu')).toHaveValue('alfa')
    expect(screen.getByLabelText('İstifadəçi adı')).toHaveValue('')
  })

  it('answers a refused sign in with one message that names none of the three, keeps the code and the username, clears the password and remembers nothing (story 4)', async () => {
    stubSignIn(refused)
    const { router } = renderApp('/sign-in')
    await screen.findByRole('heading', { level: 1, name: 'Daxil ol' })

    await fillIn({ code: 'alfa', username: 'dr.leyla', password: 'not the password' })

    expect(await screen.findByText('Klinika kodu, istifadəçi adı və ya şifrə düzgün deyil')).toBeInTheDocument()
    expect(screen.getByText('Hər üçünü yoxlayın və yenidən cəhd edin.')).toBeInTheDocument()
    expect(screen.getByLabelText('Klinika kodu')).toHaveValue('alfa')
    expect(screen.getByLabelText('İstifadəçi adı')).toHaveValue('dr.leyla')
    expect(screen.getByLabelText('Şifrə')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Daxil ol' })).not.toBeDisabled()
    expect(router.state.location.pathname).toBe('/sign-in')
    expect(localStorage.getItem('vetora.clinicCode')).toBeNull()
  })

  it('asks for every empty field under it and sends nothing', async () => {
    const { asked } = stubSignIn(signedIn)
    renderApp('/sign-in')
    await screen.findByRole('heading', { level: 1, name: 'Daxil ol' })

    await fillIn({ code: '', username: 'dr.leyla' })

    expect(screen.getAllByText('Bu sahəni doldurun')).toHaveLength(2)
    expect(screen.getByLabelText('Klinika kodu')).toHaveAccessibleDescription('Bu sahəni doldurun')
    expect(screen.getByLabelText('Şifrə')).toHaveAccessibleDescription('Bu sahəni doldurun')
    expect(asked.filter((request) => request.path === '/api/auth/sign-in/username')).toEqual([])
  })

  it('says there is no connection when the request does not reach the API, and keeps what was typed', async () => {
    stubSignIn(() => 'offline')
    renderApp('/sign-in')
    await screen.findByRole('heading', { level: 1, name: 'Daxil ol' })

    await fillIn({ code: 'alfa', username: 'dr.leyla', password: 'correct horse battery staple' })

    expect(await screen.findByText('Bağlantı yoxdur')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Şifrə')).toHaveValue('correct horse battery staple'))
  })
})
