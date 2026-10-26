import type { RequestIdVariables } from 'hono/request-id'

/** What every request carries through the app: the request id (hono/request-id), which problem() and the log read. */
export type Env = { Variables: RequestIdVariables }
