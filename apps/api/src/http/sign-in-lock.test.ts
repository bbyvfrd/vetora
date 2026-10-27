import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auth } from '../platform/auth/auth.js'
import { migrate } from '../platform/db/migrator.js'
import {
  connectTestClient,
  databaseTestsEnabled,
  resetTestDatabase,
  TEST_PASSWORD,
  type TestClient,
  type TestDatabaseUrls,
  testDatabaseUrls,
} from '../platform/db/test-support.js'
import {
  type ApiPractice,
  commandEnv,
  type Login,
  provisionApiPractice,
  refusal,
  runCommand,
  signIn,
} from '../test-support.js'

/**
 * The per account lock (spec #18, "Identity and access"; ticket #20; stories 5, 6 and 17) at seam 2: five failed sign
 * ins for one username within 15 minutes lock it for 15 minutes, counted per username and never per address, whether
 * or not a login has that username. The addresses come from the documentation ranges (RFC 5737).
 */

const WRONG = 'not the password at all'

/** What the sixth try answers, whatever its password: no cookie, no session. */
const LOCKED = {
  status: 429,
  type: 'about:blank',
  title: 'Login locked',
  contentType: 'application/problem+json',
  cookies: [],
}

describe.skipIf(!databaseTestsEnabled())('the sign in lock (spec #18, seam 2: the API seam)', () => {
  let urls: TestDatabaseUrls
  let migrator: TestClient
  let practice: ApiPractice
  let leyla: Login

  beforeAll(async () => {
    urls = testDatabaseUrls()
    await resetTestDatabase(urls)
    await migrate({ url: urls.migrator })
    migrator = await connectTestClient(urls.migrator, 'sign-in-lock.test')
    practice = await provisionApiPractice(urls)
    leyla = await practice.addStaff('dr.leyla', ['veterinarian'])
    await practice.addStaff('aysel', ['receptionist'])
  }, 30_000)

  afterAll(async () => {
    await practice?.drop()
    await migrator?.end()
  })

  /**
   * Run `walk` with Better Auth's rate limiter on, as it is in production only (its default): the instance the app
   * runs, with the rules auth.ts gives it, counting in control.rate_limit by the address in x-forwarded-for.
   */
  async function withTheLimiter(walk: () => Promise<void>) {
    const { rateLimit } = await auth().$context
    const enabled = rateLimit.enabled
    rateLimit.enabled = true
    try {
      await walk()
    } finally {
      rateLimit.enabled = enabled
    }
  }

  /** Five failed sign ins for a handle, and the sixth, with the right password, refused. */
  async function lockOut(handle: string) {
    for (let attempt = 1; attempt <= 5; attempt++) {
      expect((await signIn(practice.slug, handle, WRONG)).status).toBe(401)
    }
    expect(await refusal(await signIn(practice.slug, handle, TEST_PASSWORD))).toEqual(LOCKED)
  }

  /** How many sessions a login has open. */
  const sessionsOf = async (userId: string) =>
    (await migrator.query<{ n: number }>('select count(*)::int as n from control.session where user_id = $1', [userId]))
      .rows[0]?.n

  it('locks a username after five failed sign ins from five addresses: the next try, with the right password, answers 429 and opens no session, while a colleague at the same computer signs in (stories 5 and 6)', async () => {
    for (const ip of ['198.51.100.1', '198.51.100.2', '198.51.100.3', '198.51.100.4', '198.51.100.5']) {
      expect((await signIn(practice.slug, 'dr.leyla', WRONG, { ip })).status, ip).toBe(401)
    }
    const sessions = await sessionsOf(leyla.userId)

    const locked = await signIn(practice.slug, 'dr.leyla', TEST_PASSWORD, { ip: '198.51.100.1' })

    expect(await refusal(locked)).toEqual(LOCKED)
    expect(await sessionsOf(leyla.userId)).toBe(sessions)
    expect((await signIn(practice.slug, 'aysel', TEST_PASSWORD, { ip: '198.51.100.1' })).status).toBe(204)
  })

  it('lets five failed sign ins with five usernames from one address lock none of them, and a sixth person signs in from there, Better Auth limiting that address as in production (story 6)', async () => {
    const colleagues = ['receptionist.1', 'receptionist.2', 'assistant.1', 'assistant.2', 'groomer.1']
    for (const handle of [...colleagues, 'dr.rauf']) await practice.addStaff(handle, ['receptionist'])
    const ip = '198.51.100.20'

    await withTheLimiter(async () => {
      for (const handle of colleagues) {
        expect((await signIn(practice.slug, handle, WRONG, { ip })).status, handle).toBe(401)
      }
      expect((await signIn(practice.slug, 'dr.rauf', TEST_PASSWORD, { ip })).status).toBe(204)
      for (const handle of colleagues) {
        expect((await signIn(practice.slug, handle, TEST_PASSWORD, { ip })).status, handle).toBe(204)
      }
    })
  })

  it('still refuses an address that sprays usernames: the 31st sign in within a minute answers 429, Too many sign in attempts, while another address signs in', async () => {
    const ip = '198.51.100.30'

    await withTheLimiter(async () => {
      for (let attempt = 1; attempt <= 30; attempt++) {
        expect((await signIn(practice.slug, `sprayed.${attempt}`, WRONG, { ip })).status, String(attempt)).toBe(401)
      }
      const refused = await signIn(practice.slug, 'aysel', TEST_PASSWORD, { ip })
      expect(await refusal(refused)).toEqual({ ...LOCKED, title: 'Too many sign in attempts' })
      expect((await signIn(practice.slug, 'aysel', TEST_PASSWORD, { ip: '198.51.100.31' })).status).toBe(204)
    })
  }, 30_000)

  it('clears the count on a successful sign in: four failures, a success and four failures leave the username unlocked', async () => {
    await practice.addStaff('dr.samir', ['veterinarian'])
    const fourFailures = async () => {
      for (let attempt = 1; attempt <= 4; attempt++) {
        expect((await signIn(practice.slug, 'dr.samir', WRONG)).status).toBe(401)
      }
    }

    await fourFailures()
    expect((await signIn(practice.slug, 'dr.samir', TEST_PASSWORD)).status).toBe(204)
    await fourFailures()

    expect((await signIn(practice.slug, 'dr.samir', TEST_PASSWORD)).status).toBe(204)
  })

  it('locks a username no login has after five failures, with the very answers a real login gets, so the lock never tells whether a login exists (story 4)', async () => {
    await practice.addStaff('dr.kamal', ['veterinarian'])
    const sixTries = async (handle: string) => {
      const answers = []
      for (let attempt = 1; attempt <= 6; attempt++) {
        answers.push(await refusal(await signIn(practice.slug, handle, WRONG)))
      }
      return answers
    }

    const real = await sixTries('dr.kamal')
    const nobody = await sixTries('dr.nobody')

    expect(nobody).toEqual(real)
    expect(nobody.map((answer) => answer.status)).toEqual([401, 401, 401, 401, 401, 429])
    expect(nobody.at(-1)).toEqual(LOCKED)
  })

  it('lets five of ten sign ins sent at once reach the password and refuses the other five as locked, so a burst never gets more than five guesses', async () => {
    await practice.addStaff('dr.nigar', ['veterinarian'])

    const burst = await Promise.all(
      Array.from({ length: 10 }, (_, attempt) =>
        signIn(practice.slug, 'dr.nigar', WRONG, { ip: `203.0.113.${attempt + 1}` }),
      ),
    )

    expect(burst.map((answer) => answer.status).sort()).toEqual([401, 401, 401, 401, 401, 429, 429, 429, 429, 429])
    expect((await signIn(practice.slug, 'dr.nigar', TEST_PASSWORD)).status).toBe(429)
  })

  it('keeps a lock for 15 minutes from the fifth failure however long ago the first was, then lets the right password in and counts afresh (the clock moved by setting the row back)', async () => {
    await practice.addStaff('dr.elvin', ['veterinarian'])
    await lockOut('dr.elvin')
    const username = `dr.elvin@${practice.slug}`

    // The first failure 20 minutes ago, the lock still running: still locked.
    await migrator.query(
      `update control.sign_in_lock set first_failed_at = now() - interval '20 minutes' where username = $1`,
      [username],
    )
    expect(await refusal(await signIn(practice.slug, 'dr.elvin', TEST_PASSWORD))).toEqual(LOCKED)

    // The lock ended a second ago: a wrong password is one failure of a new count, and the right one signs in.
    await migrator.query(
      `update control.sign_in_lock set locked_until = now() - interval '1 second' where username = $1`,
      [username],
    )
    expect((await signIn(practice.slug, 'dr.elvin', WRONG)).status).toBe(401)
    expect((await signIn(practice.slug, 'dr.elvin', TEST_PASSWORD)).status).toBe(204)
  })

  it('frees a locked username at once through unlock-login, a login or not, and prints neither the handle nor the username (story 17)', async () => {
    await practice.addStaff('dr.farid', ['veterinarian'])
    await lockOut('dr.farid')
    await lockOut('dr.ghost')
    const unlock = (handle: string) =>
      runCommand('unlock-login', ['--practice', practice.slug, '--handle', handle], commandEnv(urls))

    const unlocked = await unlock('dr.farid')
    const ghost = await unlock('dr.ghost')
    const again = await unlock('dr.farid')

    expect(unlocked.code).toBe(0)
    expect(unlocked.lines.at(-1)).toMatchObject({ msg: 'login unlocked' })
    expect((await signIn(practice.slug, 'dr.farid', TEST_PASSWORD)).status).toBe(204)
    expect(ghost.code).toBe(0)
    expect(ghost.lines.at(-1)).toMatchObject({ msg: 'login unlocked' })
    expect((await signIn(practice.slug, 'dr.ghost', WRONG)).status).toBe(401)
    expect(again.code).toBe(0)
    expect(again.lines.at(-1)).toMatchObject({ msg: 'this username was not locked; nothing changed' })
    for (const run of [unlocked, ghost, again]) {
      expect(run.stdout + run.stderr).not.toMatch(/dr\.(farid|ghost)/)
    }
  }, 30_000)
})
