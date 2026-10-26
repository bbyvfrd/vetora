import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { StaffRole } from '@vetora/contracts'
import { app } from './app.js'
import { addStaff } from './modules/identity-access/index.js'
import {
  provisionTestPractice,
  TEST_PASSWORD,
  type TestDatabaseUrls,
  type TestPractice,
} from './platform/db/test-support.js'

/**
 * The helpers of the tests beside the entry points (spec #18, Testing Decisions: seam 2, and the rehearsal): the real
 * Hono app through `app.request` against vetora_test (vitest.config.ts points the app's pool there), on a practice
 * provisioned through the provisioning code with logins from the staff service, the session cookie carried from one
 * request to the next as a browser would; and the shipped commands run as subprocesses. Every later ticket's API walk
 * starts from `provisionApiPractice()`. The database pieces are src/platform/db/test-support.ts. Left out of dist/ by
 * tsconfig.build.json.
 */

/** The origin the app is configured with under Vitest (vitest.config.ts): what a browser on it sends as Origin. */
export const testOrigin = (): string => process.env.PUBLIC_ORIGIN ?? 'http://localhost:5173'

export type CallOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** Sent as JSON. */
  body?: unknown
  /** The `name=value` pair of a session cookie. */
  cookie?: string
}

/** A request to the app as the web app sends it: same origin, JSON, the session cookie when given. */
export async function call(path: string, { method = 'GET', body, cookie }: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { origin: testOrigin() }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (cookie) headers.cookie = cookie
  return app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
}

/** The session cookie a response sets, as the `name=value` pair a browser sends back; throws when there is none. */
export function sessionCookie(response: Response): string {
  const line = response.headers.getSetCookie().find((cookie) => cookie.split('=')[0]?.endsWith('session_token'))
  const pair = line?.split(';')[0]
  if (!pair) throw new Error(`no session cookie on a ${response.status} response`)
  return pair
}

/** Sign in as the sign in page does, joining the clinic code and the username. */
export function signIn(practiceCode: string, handle: string, password: string): Promise<Response> {
  return call('/api/auth/sign-in/username', {
    method: 'POST',
    body: { username: `${handle}@${practiceCode}`, password },
  })
}

/** A signed in login of a test practice. */
export type Login = { userId: string; handle: string; password: string; cookie: string }

/** Sign a login in and keep its cookie; throws when the sign in is refused. */
export async function signedIn(practiceCode: string, handle: string, password: string, userId: string): Promise<Login> {
  const response = await signIn(practiceCode, handle, password)
  if (response.status !== 204) throw new Error(`${handle} could not sign in: ${response.status}`)
  return { userId, handle, password, cookie: sessionCookie(response) }
}

export type ApiPractice = TestPractice & {
  /** The manager provisioning created, signed in. */
  manager: Login
  /** Add a staff member through the staff service, as `add-staff` does, and sign them in. */
  addStaff: (handle: string, roles: StaffRole[], options?: { name?: string }) => Promise<Login>
}

/** A practice for the API seam: provisioned with its manager signed in, and the staff service at hand. */
export async function provisionApiPractice(
  urls: TestDatabaseUrls,
  options: Parameters<typeof provisionTestPractice>[1] = {},
): Promise<ApiPractice> {
  const practice = await provisionTestPractice(urls, options)
  const manager = await signedIn(practice.slug, practice.managerHandle, TEST_PASSWORD, practice.managerId)
  return {
    ...practice,
    manager,
    addStaff: async (handle, roles, { name = `Staff ${handle}` } = {}) => {
      const outcome = await addStaff({
        migratorUrl: urls.migrator,
        input: { practiceCode: practice.slug, handle, name, roles },
        password: async () => TEST_PASSWORD,
      })
      if (outcome.status !== 'in-place') throw new Error(`${handle} was not added: ${outcome.status}`)
      return signedIn(practice.slug, handle, TEST_PASSWORD, outcome.userId)
    },
  }
}

/** apps/api: the commands run here, so `--import=tsx` resolves from this workspace and `src/<command>.ts` is relative. */
const API_DIR = fileURLToPath(new URL('..', import.meta.url))

export type CommandRun = {
  code: number | null
  stdout: string
  stderr: string
  /** The JSON log lines the command wrote (pino, on stdout), parsed. */
  lines: Record<string, unknown>[]
}

/** The shipped commands, as `kamal app exec` runs them (`node apps/api/dist/<command>.js` in the image). */
export type Command = 'migrate' | 'provision-practice' | 'add-staff' | 'reset-password'

/**
 * One command as a subprocess, in an environment of its own: the variables given and PATH, never this process's
 * database URLs, which point at vetora. `stdin` is written to its standard input, which is not a terminal, so a
 * password prompt reads its first line (src/platform/prompt.ts).
 */
export function runCommand(
  command: Command,
  args: string[],
  env: Record<string, string>,
  stdin?: string,
): Promise<CommandRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import=tsx', `src/${command}.ts`, ...args], {
      cwd: API_DIR,
      env: { PATH: process.env.PATH ?? '', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => {
      const lines = stdout
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map((line) => JSON.parse(line) as Record<string, unknown>)
      resolve({ code, stdout, stderr, lines })
    })
    child.stdin.end(stdin ?? '')
  })
}

/**
 * The environment a command needs against vetora_test: the migrator's URL, and the API's own configuration, which the
 * commands that make logins read for Better Auth (the app's pool on vetora_test, as under Vitest).
 */
export function commandEnv(urls: TestDatabaseUrls, logLevel: 'info' | 'silent' = 'info'): Record<string, string> {
  return {
    DATABASE_URL_MIGRATOR: urls.migrator,
    DATABASE_URL_POOLED: urls.app,
    DATABASE_URL_DIRECT: urls.app,
    PUBLIC_ORIGIN: testOrigin(),
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? '',
    LOG_LEVEL: logLevel,
  }
}
