import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api'
import { and, eq, gte, isNull, sql } from 'drizzle-orm'
import { signInLock, user } from '../db/control-schema.js'
import { db } from '../db/index.js'
import { log } from '../log.js'

/**
 * The per account lock (spec #18, "Identity and access"; #20; stories 5, 6 and 17): five failed sign ins for one
 * username within 15 minutes of the first lock it for 15 minutes, counted in control.sign_in_lock per username and
 * never per address, so colleagues on one clinic network never lock each other out. Better Auth has no password
 * lockout of its own; these are its `hooks.before` and `hooks.after`, which run on its HTTP handler and its `auth.api`
 * calls alike, and see a refused sign in as the `APIError` it returned.
 *
 * An attempt counts from the moment it starts: the before hook refuses a locked username and otherwise counts the
 * attempt in one atomic upsert, so sign ins sent at once never get past five between them; the after hook clears the
 * row on a success and locks the username when a failure leaves five counted. Any username string is counted the same
 * way, a login's or not, so the answers never tell whether a login exists. Logs carry the login's id when one has the
 * username, never the username typed.
 */

/** The failed sign ins within the window that lock a username. */
const MAX_FAILURES = 5

/** The window the failures are counted in, from the first, and how long a lock lasts. */
const LOCK_MINUTES = 15

/** What a locked username's sign in throws; src/http/auth.ts answers it as `Login locked`. */
export const LOGIN_LOCKED = 'LOGIN_LOCKED'

/** Better Auth's path for sign in by username, below its base path: the hooks' and the rate limit rule's. */
export const SIGN_IN_PATH = '/sign-in/username'

const lockLog = log.child({ source: 'sign-in-lock' })

const lockWindow = sql`make_interval(mins => ${LOCK_MINUTES})`

/** The username a sign in names, lower cased as the username plugin looks it up, or undefined without one. */
function typedUsername(body: unknown): string | undefined {
  const username = (body as { username?: unknown } | undefined)?.username
  return typeof username === 'string' ? username.toLowerCase() : undefined
}

/**
 * Count an attempt for the username, or refuse it: false when the username is locked, or when five attempts are
 * already counted. A row whose lock has ended, or whose first failure is 15 minutes old without a lock, starts over.
 */
async function countAttempt(username: string): Promise<boolean> {
  // In the conflict branch the columns name the row already there.
  const { failures, firstFailedAt, lockedUntil } = signInLock
  const stale = sql`(${lockedUntil} <= now()
    or (${lockedUntil} is null and ${firstFailedAt} <= now() - ${lockWindow}))`
  const counted = await db()
    .insert(signInLock)
    .values({ username, failures: 1, firstFailedAt: sql`now()` })
    .onConflictDoUpdate({
      target: signInLock.username,
      set: {
        failures: sql`case when ${stale} then 1 else ${failures} + 1 end`,
        firstFailedAt: sql`case when ${stale} then now() else ${firstFailedAt} end`,
        lockedUntil: sql`case when ${stale} then null else ${lockedUntil} end`,
      },
      setWhere: sql`${stale} or (${lockedUntil} is null and ${failures} < ${MAX_FAILURES})`,
    })
    .returning({ failures })
  return counted.length === 1
}

/** After a failure: lock the username for 15 minutes once five attempts are counted, and log it. */
async function lockWhenDue(username: string): Promise<void> {
  const locked = await db()
    .update(signInLock)
    .set({ lockedUntil: sql`now() + ${lockWindow}` })
    .where(
      and(eq(signInLock.username, username), gte(signInLock.failures, MAX_FAILURES), isNull(signInLock.lockedUntil)),
    )
    .returning({ username: signInLock.username })
  if (locked.length === 0) return
  const [login] = await db().select({ id: user.id }).from(user).where(eq(user.username, username))
  lockLog.warn(login ? { userId: login.id } : {}, `sign in locked for ${LOCK_MINUTES} minutes`)
}

/**
 * Free a username at once: what a success does, and `unlock-login`. True when it was counted or locked.
 * @public
 */
export async function clearSignInLock(username: string): Promise<boolean> {
  const cleared = await db()
    .delete(signInLock)
    .where(eq(signInLock.username, username.toLowerCase()))
    .returning({ username: signInLock.username })
  return cleared.length > 0
}

/** The lock as Better Auth's `hooks` (src/platform/auth/auth.ts). */
export const signInLockHooks = {
  before: createAuthMiddleware(async (ctx) => {
    if (ctx.path !== SIGN_IN_PATH) return
    const username = typedUsername(ctx.body)
    if (username !== undefined && !(await countAttempt(username))) {
      throw new APIError('TOO_MANY_REQUESTS', { message: 'Login locked', code: LOGIN_LOCKED })
    }
  }),
  after: createAuthMiddleware(async (ctx) => {
    if (ctx.path !== SIGN_IN_PATH) return
    const username = typedUsername(ctx.body)
    if (username === undefined) return
    if (isAPIError(ctx.context.returned)) await lockWhenDue(username)
    else await clearSignInLock(username)
  }),
}
