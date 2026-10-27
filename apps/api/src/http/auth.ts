import { createRoute, type RouteHandler } from '@hono/zod-openapi'
import { SessionResponse, SignInRequest } from '@vetora/contracts'
import type { Context } from 'hono'
import { AUTH_BASE_PATH, auth } from '../platform/auth/auth.js'
import { LOGIN_LOCKED } from '../platform/auth/sign-in-lock.js'
import { loadConfig } from '../platform/config.js'
import { problem } from '../platform/problem.js'
import type { Env } from './env.js'

/**
 * The allowlist (spec #18; stories 20 and 21): of Better Auth's routes, only sign in by username, sign out and get
 * session are declared, and each forwards to Better Auth's handler a request of its own making, at that route's
 * canonical URL, so a path Better Auth would also answer (another route, an encoded or trailing variant) never reaches
 * it. Every other path under /api/auth falls to the app's 404, which keeps a route a Better Auth upgrade adds closed.
 * The commands use Better Auth's server API and are unaffected.
 */

export const signInRoute = createRoute({
  method: 'post',
  path: `${AUTH_BASE_PATH}/sign-in/username`,
  summary: 'Sign in',
  description:
    'Signs a staff member in with `handle@practice-code` and a password and sets the session cookie, which ends 12 hours later. Every refusal of the credentials answers the same 401, whichever part was wrong (story 4). Five failures for one username within 15 minutes lock it for 15 minutes, whether or not a login has it (story 5).',
  request: { body: { content: { 'application/json': { schema: SignInRequest } }, required: true } },
  responses: {
    204: { description: 'Signed in: the session cookie is set' },
    401: { description: 'The clinic code, username or password is not right (problem details)' },
    403: { description: "The request does not come from the app's own origin (problem details)" },
    429: {
      description:
        'The username is locked (title "Login locked"), or this client sent too many sign ins for now (problem details)',
    },
  },
})

export const signOutRoute = createRoute({
  method: 'post',
  path: `${AUTH_BASE_PATH}/sign-out`,
  summary: 'Sign out',
  description: 'Ends the session: its row is deleted and its cookie cleared.',
  responses: {
    204: { description: 'Signed out' },
    401: { description: 'There is no session to end (problem details)' },
    403: { description: "The request does not come from the app's own origin (problem details)" },
  },
})

export const getSessionRoute = createRoute({
  method: 'get',
  path: `${AUTH_BASE_PATH}/get-session`,
  summary: 'The current session',
  description: 'The signed in session and its login, or null. The session token stays in its cookie.',
  responses: {
    200: { description: 'The session, or null', content: { 'application/json': { schema: SessionResponse } } },
    429: { description: 'Too many requests from this client for now (problem details)' },
  },
})

/** The request Better Auth sees: the route's canonical URL, the caller's headers but its length, the given body. */
function forward(c: Context<Env>, route: string, init: { method: 'GET' | 'POST'; body?: string }): Request {
  const headers = new Headers(c.req.raw.headers)
  headers.delete('content-length')
  if (init.body !== undefined) headers.set('content-type', 'application/json')
  const url = new URL(`${AUTH_BASE_PATH}${route}`, loadConfig().PUBLIC_ORIGIN)
  return new Request(url, { method: init.method, headers, body: init.body })
}

/** Better Auth's cookies, set or cleared, carried onto the response the API answers with. */
function withCookies<Answer extends Response>(from: Response, to: Answer): Answer {
  for (const cookie of from.headers.getSetCookie()) to.headers.append('set-cookie', cookie)
  return to
}

/**
 * Whether a POST comes from the app's own pages: a browser sends Origin on every POST, and Better Auth checks it only
 * when a cookie comes along, so a first sign in from another site (login CSRF) would pass it. The JSON body already
 * needs a CORS preflight the API never answers; this refuses the rest, a request with no Origin included.
 */
function fromTheApp(c: Context<Env>): boolean {
  return c.req.header('origin') === new URL(loadConfig().PUBLIC_ORIGIN).origin
}

/**
 * Only the username and the password go on, so `rememberMe: false` (a day long session) or a callback URL never
 * reaches Better Auth. Success answers 204 with the cookie alone: the session token Better Auth puts in its body stays
 * out of the page's reach, as the httpOnly cookie means it to. Any refusal but a 429 is one 401; a 429 is the sign in
 * lock's (src/platform/auth/sign-in-lock.ts) or the rate limiter's, told apart by the code Better Auth's body carries.
 */
export const signIn: RouteHandler<typeof signInRoute, Env> = async (c) => {
  if (!fromTheApp(c)) return problem(c, 403, 'Origin not allowed')
  const { username, password } = c.req.valid('json')
  const answer = await auth().handler(
    forward(c, '/sign-in/username', { method: 'POST', body: JSON.stringify({ username, password }) }),
  )
  if (answer.ok) return withCookies(answer, c.body(null, 204))
  if (answer.status === 429) {
    const { code } = (await answer.json().catch(() => ({}))) as { code?: unknown }
    return problem(c, 429, code === LOGIN_LOCKED ? 'Login locked' : 'Too many sign in attempts')
  }
  return problem(c, 401, 'Sign in failed')
}

export const signOut: RouteHandler<typeof signOutRoute, Env> = async (c) => {
  if (!fromTheApp(c)) return problem(c, 403, 'Origin not allowed')
  const answer = await auth().handler(forward(c, '/sign-out', { method: 'POST', body: '{}' }))
  if (answer.ok) return withCookies(answer, c.body(null, 204))
  return withCookies(answer, problem(c, 401, 'Not signed in'))
}

/**
 * Only what the contract declares leaves: the session token, the client's IP address and user agent, and the login's
 * other fields stay in. A refusal keeps its status (the rate limiter's 429); anything else unexpected is the app's 500.
 */
export const getSession: RouteHandler<typeof getSessionRoute, Env> = async (c) => {
  const answer = await auth().handler(forward(c, '/get-session', { method: 'GET' }))
  if (answer.status === 429) return withCookies(answer, problem(c, 429, 'Too many requests'))
  if (!answer.ok) throw new Error(`get-session answered ${answer.status}`)
  return withCookies(answer, c.json(SessionResponse.parse(await answer.json()), 200))
}
