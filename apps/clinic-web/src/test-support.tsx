import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { render } from '@testing-library/react'
import type { Me } from '@vetora/contracts'
import type { Mock } from 'vitest'
import type { axe } from 'vitest-axe'
import { createAppRouter } from './router'

/**
 * The DOM tests' helpers (spec #18, Testing Decisions: seam 3): the API answered by a stubbed `fetch`, routed by method
 * and path, and the app mounted as main.tsx mounts it, on an in-memory history. Each test file hoists its own fetch
 * mock (the typed client captures `globalThis.fetch` when it is created) and hands it here. Only the tests import this
 * file, so it never reaches the build.
 */

/** One request the stubbed API received. */
export type Asked = { method: string; path: string; body: unknown }

/** An answer: a response, or no connection at all. */
export type Answer = Response | 'offline'

/**
 * The stubbed routes, keyed `METHOD /path`, or `METHOD /path/*` for every path under it (a create whose path carries
 * the new id); a route not listed answers 404. A route may hold its answer back (a promise) to show what the page
 * does while a request is under way.
 */
export type Routes = Record<string, (body: unknown) => Answer | Promise<Answer>>

/** The route that answers `key` (`METHOD /path`): the exact one, else the first `/*` one it falls under. */
function routeOf(routes: Routes, key: string): Routes[string] | undefined {
  return (
    routes[key] ??
    Object.entries(routes).find(([pattern]) => pattern.endsWith('/*') && key.startsWith(pattern.slice(0, -1)))?.[1]
  )
}

/** Answer every request through `routes` and record what was asked. */
export function stubApi(fetchMock: Mock<typeof fetch>, routes: Routes): Asked[] {
  const asked: Asked[] = []
  fetchMock.mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : new Request(String(input), init)
    const path = new URL(request.url).pathname
    const text = await request.clone().text()
    const body = text ? (JSON.parse(text) as unknown) : undefined
    asked.push({ method: request.method, path, body })
    const route = routeOf(routes, `${request.method} ${path}`)
    const answer = route ? await route(body) : Response.json({ title: 'Not found', status: 404 }, { status: 404 })
    if (answer === 'offline') throw new TypeError('Failed to fetch')
    return answer
  })
  return asked
}

/** A problem details answer, as the API sends its refusals. */
export const problemAnswer = (status: number, title: string): Response =>
  Response.json(
    { type: 'about:blank', title, status },
    { status, headers: { 'content-type': 'application/problem+json' } },
  )

/** The person `/api/me` answers with: a veterinarian of Alfa Vet, in Azerbaijani unless told otherwise. */
export function meOf(overrides: Partial<Me> = {}): Me {
  return {
    id: '019a3f00-0000-7000-8000-00000000a1fa',
    displayName: 'Leyla Həsənova',
    language: 'az',
    practice: {
      id: '019a3f00-0000-7000-8000-0000000000a1',
      name: 'Alfa Vet',
      code: 'alfa',
      roles: ['veterinarian'],
      timeZone: 'Asia/Baku',
    },
    locations: [{ id: '019a3f00-0000-7000-8000-0000000000b1', name: 'Nərimanov', isDefault: true }],
    ...overrides,
  }
}

/** Mount the app at `path` as main.tsx does, without error reporting. */
export function renderApp(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }))
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router, queryClient }
}

/** Each axe violation on one line (the rule, the elements, the help text), so a failure reads without the raw results. */
export function violationsOf(results: Awaited<ReturnType<typeof axe>>): string[] {
  return results.violations.map(
    (violation) =>
      `${violation.id} [${violation.nodes.map((node) => node.target.join(' ')).join('; ')}]: ${violation.help}`,
  )
}

/**
 * The axe rules the DOM tests leave out: the document's title is in index.html, not in this bare document, and colour
 * contrast needs a canvas jsdom lacks (the package's contrast test over the tokens proves it).
 */
export const axeOptions = { rules: { 'document-title': { enabled: false }, 'color-contrast': { enabled: false } } }
