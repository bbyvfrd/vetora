import type { paths } from '@vetora/contracts'
import createClient from 'openapi-fetch'

/**
 * The typed API client (spec 0001, "Contracts"): paths come from the generated OpenAPI types, same origin. The origin
 * is spelled out rather than '' so the client also runs where nothing resolves a relative URL: the DOM tests.
 */
export const api = createClient<paths>({ baseUrl: window.location.origin })
