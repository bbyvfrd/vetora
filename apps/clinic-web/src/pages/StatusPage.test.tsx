import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../i18n'
import { StatusPage } from './StatusPage'

// The typed client (src/api/client.ts) captures globalThis.fetch when it is created, at import, so the stub is
// installed before the imports above run.
const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', mock)
  return mock
})

/** What the API does on one health check: answers with its version, is down (the request fails), or never answers. */
type Answer = { version: string } | 'down' | 'silent'

/** Stubs fetch to answer each health check in turn (the last answer repeats) and records the paths asked. */
function stubHealthWith(answers: Answer[]): string[] {
  const requested: string[] = []
  fetchMock.mockImplementation((input) => {
    requested.push(new URL(input instanceof Request ? input.url : String(input)).pathname)
    const answer = answers[Math.min(requested.length, answers.length) - 1]
    if (answer === 'silent') return new Promise<Response>(() => {})
    if (answer === 'down') return Promise.reject(new TypeError('Failed to fetch'))
    return Promise.resolve(
      Response.json({ status: 'ok', version: answer.version, database: 'ok', time: '2026-10-24T08:00:00.000Z' }),
    )
  })
  return requested
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <StatusPage />
    </QueryClientProvider>,
  )
  return client
}

/** The page's region, named by its heading in Azerbaijani, the default language. */
const page = () => screen.getByRole('region', { name: 'API vəziyyəti' })

describe('the status page (spec #9, seam 1 in its first form: the page alone, with the real translations)', () => {
  // In braces: a value returned from beforeEach is run as a cleanup hook, and mockReset() returns the mock.
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('keeps its heading and is busy over a placeholder while the first check is in flight', () => {
    stubHealthWith(['silent'])
    renderPage()
    expect(screen.getByRole('heading', { name: 'API vəziyyəti' })).toBeInTheDocument()
    expect(page()).toHaveAttribute('aria-busy', 'true')
    // The skeleton is hidden from screen readers: nothing is announced until the answer arrives.
    expect(page().querySelector('[aria-hidden="true"]')).not.toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows a success badge with the version once the API answers', async () => {
    stubHealthWith([{ version: '0.1.0' }])
    renderPage()
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('İşləyir Versiya 0.1.0')
    // The badge carries its icon beside the word, drawn by the design system's Icon.
    expect(status.querySelector('svg')).not.toBeNull()
    expect(page()).not.toHaveAttribute('aria-busy')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('puts a danger banner first in the page when the API is down, and its "Try again" asks /api/health again', async () => {
    const requested = stubHealthWith(['down', { version: '0.2.0' }])
    renderPage()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('API vəziyyətini yükləmək mümkün olmadı')
    expect(page().firstElementChild).toBe(alert)
    expect(screen.queryByRole('status')).toBeNull()
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Yenidən cəhd et' }))
    expect(await screen.findByRole('status')).toHaveTextContent('İşləyir Versiya 0.2.0')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(requested).toEqual(['/api/health', '/api/health'])
  })

  it('replaces the badge with the banner when a later poll finds the API down', async () => {
    const requested = stubHealthWith([{ version: '0.1.0' }, 'down'])
    const client = renderPage()
    expect(await screen.findByRole('status')).toHaveTextContent('İşləyir Versiya 0.1.0')
    // The next poll, thirty seconds on, as the query client runs it; the query keeps the old answer beside the error.
    await client.refetchQueries({ queryKey: ['health'] })
    expect(await screen.findByRole('alert')).toHaveTextContent('API vəziyyətini yükləmək mümkün olmadı')
    expect(screen.queryByRole('status')).toBeNull()
    expect(requested).toEqual(['/api/health', '/api/health'])
  })
})
