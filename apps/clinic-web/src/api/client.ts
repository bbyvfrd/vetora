import type { paths } from '@vetora/contracts'
import createClient from 'openapi-fetch'

/** The typed API client (spec 0001, "Contracts"): paths come from the generated OpenAPI types, same origin. */
export const api = createClient<paths>({ baseUrl: '' })
