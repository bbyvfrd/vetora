import { auth as configured } from './auth.js'

/**
 * The configuration `auth check schema` loads (`pnpm --filter @vetora/api auth:check`; CI runs it beside db:check):
 * the instance the API runs, over the hand written control tables. The CLI asks Better Auth whether the Drizzle
 * schema holds what this configuration writes, without a database: the pool is created and never connected (the
 * spike's finding 5), so CI gives it a URL that points nowhere.
 */
export const auth = configured()
