import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from './platform/db/migrator.js'
import {
  connectTestClient,
  databaseTestsEnabled,
  escapeIdentifier as ident,
  resetTestDatabase,
  TEST_PASSWORD,
  type TestClient,
  type TestDatabaseUrls,
  testDatabaseUrls,
  UUID_V7,
} from './platform/db/test-support.js'
import {
  type ApiPractice,
  type CommandRun,
  call,
  commandEnv,
  provisionApiPractice,
  runCommand,
  sessionCookie,
  signIn,
} from './test-support.js'

/**
 * `add-staff` and `reset-password` (spec #18, "Commands"; stories 14 to 16) through the shipped entry points, as
 * `kamal app exec` runs them, with the password on standard input; what they made is then used through the API, the
 * way a staff member meets it (seam 2).
 */

/** pino's numeric levels, as the log lines carry them. */
const LEVEL = { fatal: 60 } as const

describe.skipIf(!databaseTestsEnabled())('the staff commands (spec #18, Commands: add-staff, reset-password)', () => {
  let urls: TestDatabaseUrls
  let migrator: TestClient
  let practice: ApiPractice
  const runs: CommandRun[] = []

  beforeAll(async () => {
    urls = testDatabaseUrls()
    await resetTestDatabase(urls)
    await migrate({ url: urls.migrator })
    migrator = await connectTestClient(urls.migrator, 'staff-commands.test')
    practice = await provisionApiPractice(urls)
  }, 30_000)

  afterAll(async () => {
    await practice?.drop()
    await migrator?.end()
  })

  const run = async (command: 'add-staff' | 'reset-password', args: string[], stdin?: string) => {
    const result = await runCommand(command, args, commandEnv(urls), stdin)
    runs.push(result)
    return result
  }

  const addStaff = (handle: string, roles: string, stdin = `${TEST_PASSWORD}\n`, name = 'Leyla Həsənova') =>
    run('add-staff', ['--practice', practice.slug, '--handle', handle, '--name', name, '--roles', roles], stdin)

  /** The membership and the mirror of a login, as the migrator reads them. */
  async function rolesOf(userId: string) {
    const member = await migrator.query<{ role: string }>(
      'select role from control.member where organization_id = $1 and user_id = $2',
      [practice.practiceId, userId],
    )
    const staff = await migrator.query<{ roles: string[]; display_name: string }>(
      `select roles, display_name from ${ident(practice.schema)}.staff_member where id = $1`,
      [userId],
    )
    return { member: member.rows[0]?.role, staff: staff.rows[0] }
  }

  it('add-staff adds a veterinarian with the password from standard input: exit 0, the login id on stdout, and the login signs in with its clinic code, handle and password (stories 1 and 14)', async () => {
    const added = await addStaff('dr.leyla', 'veterinarian')

    expect(added.code).toBe(0)
    const userId = added.stdout.trim().split('\n').at(-1) ?? ''
    expect(userId).toMatch(UUID_V7)
    expect(await rolesOf(userId)).toEqual({
      member: 'veterinarian',
      staff: { roles: ['veterinarian'], display_name: 'Leyla Həsənova' },
    })
    // Written by the command, which says so in the audit log (IN-1: a migration's write, no actor).
    const audit = await migrator.query(
      `select action, actor_id, source from ${ident(practice.schema)}.audit_event where row_id = $1`,
      [userId],
    )
    expect(audit.rows).toEqual([{ action: 'insert', actor_id: null, source: 'migration:add-staff' }])
    const response = await signIn(practice.slug, 'dr.leyla', TEST_PASSWORD)
    expect(response.status).toBe(204)
  })

  it('add-staff rerun with the same handle changes nothing and asks for no password: exit 0 and the same id', async () => {
    const first = (
      await migrator.query('select id from control."user" where username = \'dr.leyla@\' || $1', [practice.slug])
    ).rows[0]?.id
    const before = await rolesOf(first)

    const again = await addStaff('dr.leyla', 'receptionist', '', 'Someone else')

    expect(again.code).toBe(0)
    expect(again.stdout.trim().split('\n').at(-1)).toBe(first)
    expect(await rolesOf(first)).toEqual(before)
  })

  it('add-staff gives one login several roles, comma joined in the membership and an array in the mirror (story 22)', async () => {
    const added = await addStaff('aysel', 'receptionist,assistant')

    expect(added.code).toBe(0)
    const userId = added.stdout.trim().split('\n').at(-1) ?? ''
    expect(await rolesOf(userId)).toMatchObject({
      member: 'assistant,receptionist',
      staff: { roles: ['assistant', 'receptionist'] },
    })
  })

  it('add-staff refuses an unknown practice code, a role outside the five, a password under 10 characters and a password given as an argument, with exit 1 and nothing written', async () => {
    const users = async () => (await migrator.query('select count(*)::int as n from control."user"')).rows[0]?.n

    const before = await users()
    const unknown = await run(
      'add-staff',
      ['--practice', 'no-such-clinic', '--handle', 'x', '--name', 'X', '--roles', 'veterinarian'],
      `${TEST_PASSWORD}\n`,
    )
    const badRole = await addStaff('x', 'surgeon')
    const short = await addStaff('x', 'groomer', 'too short\n')
    const argument = await run('add-staff', [
      '--practice',
      practice.slug,
      '--handle',
      'x',
      '--name',
      'X',
      '--roles',
      'groomer',
      '--password',
      TEST_PASSWORD,
    ])

    for (const refused of [unknown, badRole, short, argument]) {
      expect(refused.code).toBe(1)
      expect(refused.lines.at(-1)).toMatchObject({ level: LEVEL.fatal })
    }
    expect(badRole.lines.at(-1)).toMatchObject({ invalid: [{ option: '--roles' }] })
    expect(await users()).toBe(before)
  })

  it('reset-password replaces the password and ends every session the person has open (story 16)', async () => {
    const first = sessionCookie(await signIn(practice.slug, 'dr.leyla', TEST_PASSWORD))
    const second = sessionCookie(await signIn(practice.slug, 'dr.leyla', TEST_PASSWORD))
    const fresh = 'a new and longer password'
    const open = async () =>
      (
        await migrator.query<{ n: number }>(
          `select count(*)::int as n from control.session s join control."user" u on u.id = s.user_id
           where u.username = 'dr.leyla@' || $1`,
          [practice.slug],
        )
      ).rows[0]?.n
    const before = await open()
    expect(before).toBeGreaterThanOrEqual(2)

    const reset = await run('reset-password', ['--practice', practice.slug, '--handle', 'dr.leyla'], `${fresh}\n`)

    expect(reset.code).toBe(0)
    expect(reset.lines.at(-1)).toMatchObject({ sessionsEnded: before, msg: 'password replaced, sessions ended' })
    expect(await open()).toBe(0)
    for (const cookie of [first, second]) {
      expect(await call('/api/auth/get-session', { cookie }).then((answer) => answer.json())).toBeNull()
    }
    expect((await signIn(practice.slug, 'dr.leyla', TEST_PASSWORD)).status).toBe(401)
    expect((await signIn(practice.slug, 'dr.leyla', fresh)).status).toBe(204)
  })

  it('reset-password refuses a handle with no login and a password under 10 characters, with exit 1, changing nothing', async () => {
    const nobody = await run(
      'reset-password',
      ['--practice', practice.slug, '--handle', 'nobody'],
      `${TEST_PASSWORD}\n`,
    )
    const short = await run('reset-password', ['--practice', practice.slug, '--handle', 'dr.leyla'], 'short\n')

    expect(nobody.code).toBe(1)
    expect(short.code).toBe(1)
    expect((await signIn(practice.slug, 'dr.leyla', 'a new and longer password')).status).toBe(204)
  })

  it('no run printed a password, a handle or a name: the commands log ids, roles and counts (spec 0002, Security model)', () => {
    expect(new Set(runs.map((result) => result.code))).toEqual(new Set([0, 1]))
    const printed = runs.map((result) => result.stdout + result.stderr).join('\n')
    for (const secret of [TEST_PASSWORD, 'a new and longer password', 'too short', 'dr.leyla', 'aysel', 'Həsənova']) {
      expect(printed, secret).not.toContain(secret)
    }
  })
})
