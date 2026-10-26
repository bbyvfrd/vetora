import { eq } from 'drizzle-orm'
import { user } from '../db/control-schema.js'
import type { LangCode } from '../db/domains.js'
import { db } from '../db/index.js'
import { auth, MIN_PASSWORD_LENGTH, withPinnedId } from './auth.js'
import { placeholderEmail, usernameOf } from './names.js'

/**
 * Logins on the server side (spec #18, "Identity and access"): what provisioning and the staff service
 * (src/modules/identity-access) do with Better Auth's server API, which no HTTP route reaches. A login is found by its
 * username, created through the admin plugin's createUser when missing, and has its password replaced with every
 * session ended. A password is asked for only when one is written, and checked here, since createUser checks only its
 * maximum length.
 */

/** Better Auth's longest password (its default maxPasswordLength). */
const MAX_PASSWORD_LENGTH = 128

/** What a password lacks for a login, or undefined when it will do: 10 characters at least, 128 at most. */
export function passwordProblem(password: string): 'too-short' | 'too-long' | undefined {
  if (password.length < MIN_PASSWORD_LENGTH) return 'too-short'
  if (password.length > MAX_PASSWORD_LENGTH) return 'too-long'
  return undefined
}

/** The id of the login with this username, or undefined. */
export async function findLogin(username: string): Promise<string | undefined> {
  const [found] = await db().select({ id: user.id }).from(user).where(eq(user.username, username))
  return found?.id
}

/** @public */
export type LoginInput = {
  handle: string
  practiceCode: string
  /** The person's display name. */
  name: string
  /** Their interface language at first: the practice's default language. */
  language: LangCode
  /** Asked only when the login is created: a hidden prompt, or standard input (src/platform/prompt.ts). */
  password: () => Promise<string>
  /** The id the new login takes, for a practice whose first manager has a staff_member row and no login yet. */
  id?: string
}

/** @public */
export type EnsuredLogin =
  | { status: 'existing'; userId: string }
  | { status: 'created'; userId: string }
  | { status: 'password-rejected'; problem: 'too-short' | 'too-long' }

/**
 * The login for `handle@practice-code`: the one already there (nothing changes), or a new one.
 * @public
 */
export async function ensureLogin(input: LoginInput): Promise<EnsuredLogin> {
  const username = usernameOf(input.handle, input.practiceCode)
  const existing = await findLogin(username)
  if (existing) return { status: 'existing', userId: existing }
  const password = await input.password()
  const problem = passwordProblem(password)
  if (problem) return { status: 'password-rejected', problem }
  const create = () =>
    auth().api.createUser({
      body: {
        email: placeholderEmail(input.handle, input.practiceCode),
        password,
        name: input.name,
        data: { username, displayUsername: username, language: input.language },
      },
    })
  const created = await (input.id ? withPinnedId('user', input.id, create) : create())
  return { status: 'created', userId: created.user.id }
}

/** @public */
export type PasswordReset =
  | { status: 'reset'; userId: string; sessionsEnded: number }
  | { status: 'no-login' }
  | { status: 'password-rejected'; problem: 'too-short' | 'too-long' }

/**
 * Replace the login's password and end every session it has open (story 16), through Better Auth's own adapter.
 * @public
 */
export async function resetPassword(username: string, password: () => Promise<string>): Promise<PasswordReset> {
  const userId = await findLogin(username)
  if (!userId) return { status: 'no-login' }
  const chosen = await password()
  const problem = passwordProblem(chosen)
  if (problem) return { status: 'password-rejected', problem }
  const context = await auth().$context
  const hash = await context.password.hash(chosen)
  if (await context.internalAdapter.findCredentialAccount(userId)) {
    await context.internalAdapter.updatePassword(userId, hash)
  } else {
    await context.internalAdapter.createAccount({ userId, providerId: 'credential', accountId: userId, password: hash })
  }
  const sessions = await context.internalAdapter.listSessions(userId)
  await context.internalAdapter.deleteUserSessions(userId)
  return { status: 'reset', userId, sessionsEnded: sessions.length }
}
