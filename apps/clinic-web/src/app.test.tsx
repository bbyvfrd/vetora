import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { languages } from '@vetora/i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { axe } from 'vitest-axe'
import { setLanguage } from './i18n'
import { routeTree } from './routeTree.gen'

// The typed client (src/api/client.ts) captures globalThis.fetch when it is created, at import, so the stub is
// installed before the imports above run.
const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', mock)
  return mock
})

/** The version the stubbed API reports; `words` spells it out in each status line. */
const version = '0.1.0'

/** The API answers every health check, so the status page settles on its success state. */
function stubHealthy() {
  fetchMock.mockImplementation(() =>
    Promise.resolve(Response.json({ status: 'ok', version, database: 'ok', time: '2026-10-26T08:00:00.000Z' })),
  )
}

/** The shell's words in each language, from the design system glossary through packages/i18n. */
const words = {
  az: {
    nav: 'Əsas naviqasiya',
    skip: 'Məzmuna keç',
    title: 'API vəziyyəti',
    language: 'Dil',
    status: 'İşləyir Versiya 0.1.0',
  },
  ru: {
    nav: 'Основная навигация',
    skip: 'Перейти к содержимому',
    title: 'Состояние API',
    language: 'Язык',
    status: 'Работает Версия 0.1.0',
  },
  en: {
    nav: 'Main navigation',
    skip: 'Skip to content',
    title: 'API status',
    language: 'Language',
    status: 'Up Version 0.1.0',
  },
} as const

/** Each axe violation on one line (the rule, the elements, the help text), so a failure reads without the raw results. */
function violationsOf(results: Awaited<ReturnType<typeof axe>>): string[] {
  return results.violations.map(
    (violation) =>
      `${violation.id} [${violation.nodes.map((node) => node.target.join(' ')).join('; ')}]: ${violation.help}`,
  )
}

/** Mounts the app as main.tsx does, without error reporting: the real route tree on an in-memory history at "/". */
async function renderApp() {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/'] }) })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  // The router renders its first match asynchronously, and the status page's answer arrives after that.
  await screen.findByRole('status')
}

describe('the shell around the status page (spec #9, seam 1 in full: the real router with the real translations)', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    stubHealthy()
    setLanguage('az')
  })

  it('renders the page inside the shell: a named rail, the h1 in the header, then the body holding the page', async () => {
    await renderApp()
    expect(screen.getByRole('navigation', { name: 'Əsas naviqasiya' })).toBeInTheDocument()
    const main = screen.getByRole('main')
    const title = within(main).getByRole('heading', { level: 1, name: 'API vəziyyəti' })
    const page = within(main).getByRole('region', { name: 'API vəziyyəti' })
    // The header comes first, the body with the page after it.
    expect(title.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(within(page).getByRole('status')).toHaveTextContent('İşləyir Versiya 0.1.0')
  })

  it('puts the skip link first in the tab order, then the rail item, then the language switch', async () => {
    await renderApp()
    const user = userEvent.setup()
    await user.tab()
    expect(screen.getByRole('link', { name: 'Məzmuna keç' })).toHaveFocus()
    await user.tab()
    expect(within(screen.getByRole('navigation')).getByRole('link', { name: 'API vəziyyəti' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('combobox', { name: 'Dil' })).toHaveFocus()
  })

  it('moves focus to the page when the skip link is used', async () => {
    await renderApp()
    const user = userEvent.setup()
    await user.tab()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('main')).toHaveFocus()
  })

  it('lists only the routed places in the rail, the current one marked as the page', async () => {
    await renderApp()
    const links = within(screen.getByRole('navigation', { name: 'Əsas naviqasiya' })).getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAccessibleName('API vəziyyəti')
    expect(links[0]).toHaveAttribute('aria-current', 'page')
    expect(links[0]).toHaveAttribute('href', '/')
  })

  it("changes every word and the page's language from the switch in the rail's foot, and keeps the choice", async () => {
    await renderApp()
    const user = userEvent.setup()
    for (const language of ['ru', 'en', 'az'] as const) {
      await user.selectOptions(screen.getByRole('combobox'), language)
      const expected = words[language]
      expect(await screen.findByRole('heading', { level: 1, name: expected.title })).toBeInTheDocument()
      const nav = screen.getByRole('navigation', { name: expected.nav })
      expect(within(nav).getByRole('link', { name: expected.title })).toHaveAttribute('aria-current', 'page')
      expect(screen.getByRole('region', { name: expected.title })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: expected.skip })).toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: expected.language })).toHaveValue(language)
      expect(screen.getByRole('status')).toHaveTextContent(expected.status)
      expect(document.documentElement.lang).toBe(language)
      expect(localStorage.getItem('vetora.language')).toBe(language)
    }
  })

  it.each(languages)('has no axe violations in %s', async (language) => {
    await renderApp()
    await userEvent.setup().selectOptions(screen.getByRole('combobox'), language)
    await screen.findByRole('heading', { level: 1, name: words[language].title })
    // Two rules are left out: the document's title is in index.html, not in this bare document, and colour contrast
    // needs a canvas jsdom lacks (seam 2, the package's contrast test over the tokens, proves it).
    const results = await axe(document.body, {
      rules: { 'document-title': { enabled: false }, 'color-contrast': { enabled: false } },
    })
    expect(violationsOf(results)).toEqual([])
  })
})
