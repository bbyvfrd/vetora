import type { paths } from '@vetora/contracts'
import createClient from 'openapi-fetch'

/**
 * The typed API client (spec 0001, "Contracts"): paths come from the generated OpenAPI types, same origin. The origin
 * is spelled out rather than '' so the client also runs where nothing resolves a relative URL: the DOM tests.
 */
export const api = createClient<paths>({ baseUrl: window.location.origin })

let unauthorized: (() => void) | undefined

/**
 * Hear every 401 a vetora route answers (spec #18: any 401 from the API leads to the sign in page); Better Auth's own
 * routes are left out, since a refused sign in answers 401 too. One listener at a time, the router's (src/router.ts).
 */
export function whenUnauthorized(listener: () => void): void {
  unauthorized = listener
}

api.use({
  onResponse({ request, response }) {
    if (response.status === 401 && !new URL(request.url).pathname.startsWith('/api/auth/')) unauthorized?.()
    return undefined
  },
})
