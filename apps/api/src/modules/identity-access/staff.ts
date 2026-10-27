import { z } from 'zod'
import { ensureLogin, resetPassword } from '../../platform/auth/logins.js'
import { HANDLE, PRACTICE_CODE, usernameOf } from '../../platform/auth/names.js'
import { clearSignInLock } from '../../platform/auth/sign-in-lock.js'
import { type CommandSession, quoteIdentifier, withCommandSession } from '../../platform/db/command-session.js'
import type { LangCode } from '../../platform/db/domains.js'
import { joinRoles, orderRoles, parseRoles, STAFF_ROLES, type StaffRole } from '../../platform/db/platform-tables.js'
import { uuidv7 } from '../../platform/ids.js'

/**
 * The staff service (spec #18, "Identity and access"; stories 14, 16, 17 and 22): the one way a staff member gets a
 * login and the roles of their practice, used by `add-staff`, `reset-password` and `unlock-login` today and by feature
 * 15's staff screen later. A login is created
 * through Better Auth's createUser, then the membership (`control.member`, the roles comma joined, the source of truth)
 * and the practice's `staff_member` row (the roles as an array, the mirror every write's actor names) are written in
 * one transaction, so the API's checks and the database's triggers never disagree. A rerun with a handle already there
 * completes whatever is missing, from what is there: the membership's roles and the login's name win over the
 * arguments, and nothing that exists is changed.
 */

/** The arguments of an addition, validated. */
export const staffInput = z.object({
  practiceCode: z.string().regex(PRACTICE_CODE, 'a practice code such as alfa'),
  handle: z.string().regex(HANDLE, 'lower case letters, digits, dots and underscores, starting with a letter or digit'),
  name: z.string().trim().min(1),
  /** One role or several, kept in the order of STAFF_ROLES. */
  roles: z.array(z.enum(STAFF_ROLES)).min(1).transform(orderRoles),
})

export type StaffInput = z.output<typeof staffInput>

export type StaffOutcome =
  /** The login, the membership and the staff_member row are all in place; `written` says which this run added. */
  | {
      status: 'in-place'
      practiceId: string
      userId: string
      roles: StaffRole[]
      written: { login: boolean; membership: boolean; staffMember: boolean }
    }
  /** The practice code names no active practice with its organization: nothing was written. */
  | { status: 'no-practice' }
  | { status: 'password-rejected'; problem: 'too-short' | 'too-long' }

type Practice = { id: string; schema: string; defaultLanguage: LangCode }

/**
 * Add a staff member to a practice, or complete one an earlier run left half done. `password` is asked for only when
 * the login is created. Writes as the migrator, so the rows are audited as `migration:<command>`.
 */
export async function addStaff(options: {
  migratorUrl: string
  input: StaffInput
  password: () => Promise<string>
  command?: string
}): Promise<StaffOutcome> {
  const { input } = options
  return withCommandSession({ url: options.migratorUrl, command: options.command ?? 'add-staff' }, async (session) => {
    const practice = await activePractice(session, input.practiceCode)
    if (!practice) return { status: 'no-practice' }
    const login = await ensureLogin({
      handle: input.handle,
      practiceCode: input.practiceCode,
      name: input.name,
      language: practice.defaultLanguage,
      password: options.password,
    })
    if (login.status === 'password-rejected') return login
    const { userId } = login
    return session.transaction(async () => {
      // The membership first, inserted only when missing; the mirror then takes the roles the membership holds.
      const membership = await session.query(
        `insert into control.member (id, organization_id, user_id, role, created_at)
         values ($1, $2, $3, $4, now())
         on conflict (organization_id, user_id) do nothing`,
        [uuidv7(), practice.id, userId, joinRoles(input.roles)],
      )
      const held = await session.query<{ role: string; name: string }>(
        `select m.role, u.name from control.member m join control."user" u on u.id = m.user_id
         where m.organization_id = $1 and m.user_id = $2`,
        [practice.id, userId],
      )
      const row = held.rows[0]
      if (!row) throw new Error('the membership is missing after its insert')
      const roles = parseRoles(row.role)
      const staffMember = await session.query(
        `insert into ${quoteIdentifier(practice.schema)}.staff_member (id, display_name, roles, active, synced_at)
         values ($1, $2, $3, true, now())
         on conflict (id) do nothing`,
        [userId, row.name, roles],
      )
      return {
        status: 'in-place',
        practiceId: practice.id,
        userId,
        roles,
        written: {
          login: login.status === 'created',
          membership: membership.rowCount === 1,
          staffMember: staffMember.rowCount === 1,
        },
      }
    })
  })
}

/** The practice behind a code, when it is active and its organization exists (provisioning completed it). */
async function activePractice(session: CommandSession, practiceCode: string): Promise<Practice | undefined> {
  const registry = await session.query<{ id: string; schema_name: string }>(
    `select p.id, p.schema_name from control.practice p join control.organization o on o.id = p.id
     where p.slug = $1 and p.status = 'active'`,
    [practiceCode],
  )
  const found = registry.rows[0]
  if (!found) return undefined
  const settings = await session.query<{ default_language: LangCode }>(
    `select default_language from ${quoteIdentifier(found.schema_name)}.practice_settings`,
  )
  const defaultLanguage = settings.rows[0]?.default_language
  if (!defaultLanguage) return undefined
  return { id: found.id, schema: found.schema_name, defaultLanguage }
}

/** The arguments of a password reset, validated. */
export const resetInput = staffInput.pick({ practiceCode: true, handle: true })

export type ResetInput = z.output<typeof resetInput>

/** Replace a staff member's password and end every session they have open (story 16). */
export function resetStaffPassword(input: ResetInput, password: () => Promise<string>) {
  return resetPassword(usernameOf(input.handle, input.practiceCode), password)
}

/** The arguments of an unlock, validated: the same two as a reset's. */
export const unlockInput = resetInput

export type UnlockInput = ResetInput

/**
 * Free a username the sign in lock holds, at once (story 17; feature 15 puts it behind the manager's button): whether
 * a login has the username or not, as the lock itself never tells.
 */
export async function unlockLogin(input: UnlockInput): Promise<{ status: 'unlocked' | 'not-locked' }> {
  const cleared = await clearSignInLock(usernameOf(input.handle, input.practiceCode))
  return { status: cleared ? 'unlocked' : 'not-locked' }
}
