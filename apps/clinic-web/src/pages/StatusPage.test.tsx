import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
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

/** Stubs fetch to answer every health check in turn with the given versions (the last one repeats) and records the paths asked. */
function stubHealthWith(versions: string[]): string[] {
  const requested: string[] = []
  fetchMock.mockImplementation(async (input) => {
    requested.push(new URL(input instanceof Request ? input.url : String(input)).pathname)
    const version = versions[Math.min(requested.length, versions.length) - 1]
    return Response.json({ status: 'ok', version, database: 'ok', time: '2026-10-24T08:00:00.000Z' })
  })
  return requested
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <StatusPage />
    </QueryClientProvider>,
  )
}

describe('the status page (spec #9, seam 1 in its first form: the page alone, with the real translations)', () => {
  // In braces: a value returned from beforeEach is run as a cleanup hook, and mockReset() returns the mock.
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('shows the health check in Azerbaijani, the default language', async () => {
    stubHealthWith(['0.1.0'])
    renderPage()
    expect(screen.getByRole('heading', { name: 'API vəziyyəti' })).toBeInTheDocument()
    expect(await screen.findByRole('status')).toHaveTextContent('İşləyir · Versiya 0.1.0')
  })

  it('offers "Try again" as a button with its icon drawn', async () => {
    stubHealthWith(['0.1.0'])
    renderPage()
    const button = screen.getByRole('button', { name: 'Yenidən cəhd et' })
    // Beside its label the icon is decoration, hidden from screen readers, so it is checked as the drawing inside.
    expect(button.querySelector('svg')).not.toBeNull()
    expect(await screen.findByRole('status')).toBeInTheDocument()
  })

  it('asks /api/health again when "Try again" is pressed', async () => {
    const requested = stubHealthWith(['0.1.0', '0.2.0'])
    renderPage()
    await screen.findByText('İşləyir · Versiya 0.1.0')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Yenidən cəhd et' }))
    expect(await screen.findByText('İşləyir · Versiya 0.2.0')).toBeInTheDocument()
    expect(requested).toEqual(['/api/health', '/api/health'])
  })
})
