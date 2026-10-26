/**
 * @vetora/contracts: the zod schemas every route is declared with, the staff roles and the permission matrix both apps
 * read, and the types generated from the API's OpenAPI document (spec 0001, "Contracts"; spec #18).
 */

export * from './auth.js'
export type { components, operations, paths } from './generated/api.js'
export * from './health.js'
export * from './me.js'
export * from './staff.js'
