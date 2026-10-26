import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Me } from '@vetora/contracts'
import { languages } from '@vetora/i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { setLanguage } from './i18n'
import { axeOptions, meOf, problemAnswer, renderApp, stubApi, violationsOf } from './test-support'

// The typed client (src/api/client.ts) captures globalThis.fetch when it is created, at import, so the stub is
// installed before the imports above run.
const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', mock)
  return mock
})

/** The shell's words in each language, from the design system glossary through packages/i18n. */
const words = {
  az: {
    nav: 'Əsas naviqasiya',
    skip: 'Məzmuna keç',
    title: 'Bugünkü qəbullar',
    empty: 'Bu gün qəbul yoxdur',
    status: 'API vəziyyəti',
    account: 'Leyla Həsənova Baytar həkim · Alfa Vet',
  },
  ru: {
    nav: 'Основная навигация',
    skip: 'Перейти к содержимому',
    title: 'Приёмы сегодня',
    empty: 'Сегодня приёмов нет',
    status: 'Состояние API',
    account: 'Leyla Həsənova Ветеринарный врач · Alfa Vet',
  },
  en: {
    nav: 'Main navigation',
    skip: 'Skip to content',
    title: 'Visits today',
    empty: 'No visits today',
    status: 'API status',
    account: 'Leyla Həsənova Veterinarian · Alfa Vet',
  },
} as const

/** The API as a signed in vet's browser finds it: `/api/me` answers while `signedIn` holds, then 401. */
function stubSignedIn(me: Me = meOf()) {
  const state = { signedIn: true }
  const asked = stubApi(fetchMock, {
    'GET /api/me': () => (state.signedIn ? Response.json(me) : problemAnswer(401, 'Not signed in')),
    'GET /api/health': () =>
      Response.json({ status: 'ok', version: '0.1.0', database: 'ok', time: '2026-10-26T08:00:00.000Z' }),
  })
  return { state, asked }
}

describe('the shell around the signed in pages (spec #9 seam 1, spec #18 seam 3: the real router with the real translations)', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    localStorage.clear()
    setLanguage('az')
  })

  it('lands on Visits today inside the shell: a named rail, the h1 in the header, then the body with its empty state', async () => {
    stubSignedIn()
    renderApp('/')

    const main = await screen.findByRole('main')
    const title = await within(main).findByRole('heading', { level: 1, name: 'Bugünkü qəbullar' })
    expect(screen.getByRole('navigation', { name: 'Əsas naviqasiya' })).toBeInTheDocument()
    const empty = within(main).getByText('Bu gün qəbul yoxdur')
    expect(title.compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
  })

  it('lists the routed places, Visits today first and marked as the page, then the status page; the account entry names the person, their role and clinic, and leads to their profile (story 11)', async () => {
    stubSignedIn()
    renderApp('/')
    await screen.findByRole('heading', { level: 1, name: 'Bugünkü qəbullar' })

    const links = within(screen.getByRole('navigation', { name: 'Əsas naviqasiya' })).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/', '/status', '/profile'])
    expect(links[0]).toHaveAccessibleName('Bugünkü qəbullar')
    expect(links[0]).toHaveAttribute('aria-current', 'page')
    expect(links[1]).toHaveAccessibleName('API vəziyyəti')
    expect(links[1]).not.toHaveAttribute('aria-current')
    expect(links[2]).toHaveAccessibleName(words.az.account)
    // The temporary language switch is gone from the rail: the language lives in the profile (spec #18).
    expect(screen.queryByRole('combobox')).toBeNull()

    await userEvent.setup().click(links[1] as HTMLElement)
    expect(await screen.findByRole('heading', { level: 1, name: 'API vəziyyəti' })).toBeInTheDocument()
    expect(links[1]).toHaveAttribute('aria-current', 'page')
  })

  it('puts the skip link first in the tab order, then the two places, then the account entry, and the skip link focuses the page', async () => {
    stubSignedIn()
    renderApp('/')
    await screen.findByRole('heading', { level: 1, name: 'Bugünkü qəbullar' })
    const user = userEvent.setup()

    await user.tab()
    expect(screen.getByRole('link', { name: 'Məzmuna keç' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('link', { name: 'Bugünkü qəbullar' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('link', { name: 'API vəziyyəti' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('link', { name: words.az.account })).toHaveFocus()

    await user.tab({ shift: true })
    await user.tab({ shift: true })
    await user.tab({ shift: true })
    await user.keyboard('{Enter}')
    expect(screen.getByRole('main')).toHaveFocus()
  })

  it.each(languages)(
    "speaks the language saved to the person's login, %s, whatever this computer chose before, with no axe violation (story 12)",
    async (language) => {
      stubSignedIn(meOf({ language }))
      setLanguage(language === 'az' ? 'en' : 'az')
      renderApp('/')

      const expected = words[language]
      expect(await screen.findByRole('heading', { level: 1, name: expected.title })).toBeInTheDocument()
      expect(screen.getByRole('navigation', { name: expected.nav })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: expected.skip })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: expected.status })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: expected.account })).toBeInTheDocument()
      expect(screen.getByText(expected.empty)).toBeInTheDocument()
      expect(document.documentElement.lang).toBe(language)
      expect(violationsOf(await axe(document.body, axeOptions))).toEqual([])
    },
  )

  it('sends a computer with no session to the sign in page, with no message about a session ending', async () => {
    const { state } = stubSignedIn()
    state.signedIn = false
    const { router } = renderApp('/status')

    expect(await screen.findByRole('heading', { level: 1, name: 'Daxil ol' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/sign-in')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('Sessiyanın vaxtı bitdi')).toBeNull()
  })

  it('sends the person to the sign in page with "Your session has ended" when the API answers 401 after they signed in', async () => {
    const { state } = stubSignedIn()
    const { router, queryClient } = renderApp('/')
    await screen.findByRole('heading', { level: 1, name: 'Bugünkü qəbullar' })

    state.signedIn = false
    await queryClient.invalidateQueries({ queryKey: ['me'] })

    expect(await screen.findByText('Sessiyanın vaxtı bitdi')).toBeInTheDocument()
    expect(screen.getByText('Davam etmək üçün yenidən daxil olun.')).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))
    expect(queryClient.getQueryData(['me'])).toBeUndefined()
  })
})
