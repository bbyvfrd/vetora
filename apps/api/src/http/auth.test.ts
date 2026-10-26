import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { app } from '../app.js'
import { migrate } from '../platform/db/migrator.js'
import {
  connectTestClient,
  databaseTestsEnabled,
  PERMISSION_DENIED,
  resetTestDatabase,
  TEST_PASSWORD,
  type TestClient,
  type TestDatabaseUrls,
  testDatabaseUrls,
} from '../platform/db/test-support.js'
import { type ApiPractice, call, type Login, provisionApiPractice, sessionCookie, signIn } from '../test-support.js'

const HOUR = 60 * 60 * 1000

/** What a refused sign in answers, minus the parts that differ per request (its id). */
async function refusal(response: Response) {
  const body = (await response.json()) as Record<string, unknown>
  return {
    status: response.status,
    type: body.type,
    title: body.title,
    contentType: response.headers.get('content-type'),
  }
}

describe.skipIf(!databaseTestsEnabled())('signing in through the allowlist (spec #18, seam 2: the API seam)', () => {
  let urls: TestDatabaseUrls
  let migrator: TestClient
  let practice: ApiPractice
  let vet: Login

  beforeAll(async () => {
    urls = testDatabaseUrls()
    await resetTestDatabase(urls)
    await migrate({ url: urls.migrator })
    migrator = await connectTestClient(urls.migrator, 'auth.test')
    practice = await provisionApiPractice(urls)
    vet = await practice.addStaff('dr.leyla', ['veterinarian'], { name: 'Leyla Həsənova' })
  }, 30_000)

  afterEach(() => {
    vi.useRealTimers()
  })

  afterAll(async () => {
    await practice?.drop()
    await migrator?.end()
  })

  it('signs in a login the staff service created, with its clinic code, handle and password; get session then names it with the fields of its contract alone, no token, IP address or email among them (story 1)', async () => {
    const response = await signIn(practice.slug, 'dr.leyla', TEST_PASSWORD)

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    const session = await call('/api/auth/get-session', { cookie: sessionCookie(response) })
    expect(session.status).toBe(200)
    const body = (await session.json()) as { session: Record<string, unknown>; user: Record<string, unknown> }
    expect(body.user).toEqual({
      id: vet.userId,
      name: 'Leyla Həsənova',
      username: `dr.leyla@${practice.slug}`,
      language: 'az',
    })
    expect(Object.keys(body.session).sort()).toEqual(['expiresAt', 'id', 'userId'])
    expect(await call('/api/auth/get-session').then((answer) => answer.json())).toBeNull()
  })

  it('answers a wrong password, a wrong handle, a wrong clinic code and a username that cannot exist with one and the same 401 (story 4)', async () => {
    const answers = [
      await signIn(practice.slug, 'dr.leyla', 'not the password at all'),
      await signIn(practice.slug, 'dr.nobody', TEST_PASSWORD),
      await signIn('no-such-clinic', 'dr.leyla', TEST_PASSWORD),
      await signIn(practice.slug, 'Dr Leyla!', TEST_PASSWORD),
    ]

    const refusals = await Promise.all(answers.map(refusal))
    expect(refusals[0]).toEqual({
      status: 401,
      type: 'about:blank',
      title: 'Sign in failed',
      contentType: 'application/problem+json',
    })
    expect(new Set(refusals.map((answer) => JSON.stringify(answer))).size).toBe(1)
    for (const answer of answers) expect(answer.headers.getSetCookie()).toEqual([])
  })

  it('refuses a sign in or a sign out sent from another origin or with none, the right credentials notwithstanding (login CSRF): 403, no cookie, the session kept', async () => {
    const cookie = sessionCookie(await signIn(practice.slug, 'dr.leyla', TEST_PASSWORD))
    const body = JSON.stringify({ username: `dr.leyla@${practice.slug}`, password: TEST_PASSWORD })
    for (const origin of ['https://evil.example', undefined]) {
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (origin) headers.origin = origin
      const response = await app.request('/api/auth/sign-in/username', { method: 'POST', headers, body })
      expect(response.status, String(origin)).toBe(403)
      expect(response.headers.getSetCookie(), String(origin)).toEqual([])
      const out = await app.request('/api/auth/sign-out', { method: 'POST', headers: { ...headers, cookie } })
      expect(out.status, String(origin)).toBe(403)
    }
    expect(await call('/api/auth/get-session', { cookie }).then((answer) => answer.json())).toMatchObject({
      user: { id: vet.userId },
    })
  })

  it('sets an httpOnly, SameSite=Lax session cookie that ends 12 hours after sign in, which a later request does not move (story 8)', async () => {
    const signedInAt = Date.now()
    const response = await signIn(practice.slug, 'dr.leyla', TEST_PASSWORD)
    const line = response.headers.getSetCookie().find((cookie) => cookie.includes('session_token')) ?? ''
    expect(line).toMatch(/; Max-Age=43200/)
    expect(line).toMatch(/; HttpOnly/)
    expect(line).toMatch(/; SameSite=Lax/)
    // http locally and in the tests; https in staging and production, where Better Auth adds Secure.
    expect(line).not.toMatch(/; Secure/)
    const cookie = sessionCookie(response)
    const expiresAt = async () =>
      (
        await migrator.query<{ expires_at: Date }>(
          `select expires_at from control.session where user_id = $1 order by created_at desc limit 1`,
          [vet.userId],
        )
      ).rows[0]?.expires_at.getTime()
    const ends = (await expiresAt()) ?? 0
    expect(Math.abs(ends - (signedInAt + 12 * HOUR))).toBeLessThan(5_000)

    // Eleven hours on, a request still finds the session and leaves its end where it was.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(signedInAt + 11 * HOUR)
    const later = await call('/api/auth/get-session', { cookie })
    expect(await later.json()).toMatchObject({ user: { id: vet.userId } })
    expect(later.headers.getSetCookie()).toEqual([])
    expect(await expiresAt()).toBe(ends)

    // Twelve hours and a minute after sign in, the same cookie opens nothing.
    vi.setSystemTime(signedInAt + 12 * HOUR + 60_000)
    expect(await call('/api/auth/get-session', { cookie }).then((answer) => answer.json())).toBeNull()
  })

  it('keeps a session at 12 hours when the client asks not to be remembered: rememberMe never reaches Better Auth', async () => {
    const response = await call('/api/auth/sign-in/username', {
      method: 'POST',
      body: { username: `dr.leyla@${practice.slug}`, password: TEST_PASSWORD, rememberMe: false },
    })

    expect(response.status).toBe(204)
    const rows = await migrator.query<{ hours: number }>(
      `select extract(epoch from expires_at - created_at) / 3600 as hours
       from control.session where user_id = $1 order by created_at desc limit 1`,
      [vet.userId],
    )
    expect(Math.round(Number(rows.rows[0]?.hours))).toBe(12)
  })

  it('deletes the session row on sign out, after which its cookie opens nothing (story 9)', async () => {
    const cookie = sessionCookie(await signIn(practice.slug, 'dr.leyla', TEST_PASSWORD))
    const token = decodeURIComponent(cookie.split('=')[1] ?? '').split('.')[0]
    const sessionRows = () =>
      migrator.query('select id from control.session where token = $1', [token]).then((result) => result.rowCount)
    expect(await sessionRows()).toBe(1)

    const out = await call('/api/auth/sign-out', { method: 'POST', cookie })

    expect(out.status).toBe(204)
    expect(out.headers.getSetCookie().some((line) => line.includes('session_token=;'))).toBe(true)
    expect(await sessionRows()).toBe(0)
    expect(await call('/api/auth/get-session', { cookie }).then((answer) => answer.json())).toBeNull()
  })

  it('holds the username immutable and the logins and memberships undeletable at the data: vetora_app, the role Better Auth runs as, can do neither (immutableUsername; IN-6)', async () => {
    const app = await connectTestClient(urls.app, 'auth.test app')
    try {
      await expect(
        app.query(`update control."user" set username = 'someone@' || $2 where id = $1`, [vet.userId, practice.slug]),
      ).rejects.toMatchObject(PERMISSION_DENIED)
      await expect(
        app.query('update control."user" set email = $2 where id = $1', [vet.userId, 'x@y.invalid']),
      ).rejects.toMatchObject(PERMISSION_DENIED)
      await expect(app.query('delete from control."user" where id = $1', [vet.userId])).rejects.toMatchObject(
        PERMISSION_DENIED,
      )
      await expect(app.query('delete from control.member where user_id = $1', [vet.userId])).rejects.toMatchObject(
        PERMISSION_DENIED,
      )
      await expect(
        app.query(`update control.member set role = 'manager' where user_id = $1`, [vet.userId]),
      ).rejects.toMatchObject(PERMISSION_DENIED)
      // What /api/me/language writes stays open to it.
      const saved = await app.query(`update control."user" set language = 'en', updated_at = now() where id = $1`, [
        vet.userId,
      ])
      expect(saved.rowCount).toBe(1)
    } finally {
      await app.end()
    }
  })

  it('answers 404 on every Better Auth path but the three, signed in or not: sign up, update user, change password, the organization and admin paths among them, and writes nothing (stories 20 and 21)', async () => {
    const before = await migrator.query('select count(*)::int as users from control."user"')
    const closed: Array<['GET' | 'POST', string, unknown?]> = [
      [
        'POST',
        '/api/auth/sign-up/email',
        { email: 'x@example.com', password: TEST_PASSWORD, name: 'X', username: 'x' },
      ],
      [
        'POST',
        '/api/auth/sign-in/email',
        { email: `dr.leyla@${practice.slug}.staff.invalid`, password: TEST_PASSWORD },
      ],
      ['POST', '/api/auth/update-user', { name: 'Someone else', username: 'other' }],
      ['POST', '/api/auth/change-password', { currentPassword: TEST_PASSWORD, newPassword: 'another long one' }],
      ['POST', '/api/auth/change-email', { newEmail: 'x@example.com' }],
      ['POST', '/api/auth/delete-user', {}],
      ['POST', '/api/auth/request-password-reset', { email: 'x@example.com' }],
      ['GET', '/api/auth/list-sessions'],
      ['POST', '/api/auth/revoke-sessions', {}],
      ['POST', '/api/auth/is-username-available', { username: 'x@y' }],
      ['POST', '/api/auth/organization/create', { name: 'Other', slug: 'other' }],
      ['POST', '/api/auth/organization/update-member-role', { memberId: vet.userId, role: 'manager' }],
      ['POST', '/api/auth/organization/invite-member', { email: 'x@example.com', role: 'manager' }],
      ['POST', '/api/auth/organization/set-active', { organizationId: practice.practiceId }],
      ['GET', '/api/auth/organization/list'],
      ['POST', '/api/auth/admin/create-user', { email: 'x@example.com', password: TEST_PASSWORD, name: 'X' }],
      ['POST', '/api/auth/admin/set-role', { userId: vet.userId, role: 'admin' }],
      ['POST', '/api/auth/admin/set-user-password', { userId: vet.userId, newPassword: 'another long one' }],
      ['GET', '/api/auth/admin/list-users'],
      ['GET', '/api/auth/sign-in/username'],
      ['POST', '/api/auth/sign-in/username/', { username: `dr.leyla@${practice.slug}`, password: TEST_PASSWORD }],
      ['GET', '/api/auth/ok'],
    ]

    for (const cookie of [undefined, practice.manager.cookie]) {
      for (const [method, path, body] of closed) {
        const response = await call(path, { method, body, cookie })
        expect(response.status, `${method} ${path}`).toBe(404)
        expect(response.headers.get('content-type'), `${method} ${path}`).toBe('application/problem+json')
      }
    }
    expect((await migrator.query('select count(*)::int as users from control."user"')).rows).toEqual(before.rows)
    expect((await migrator.query('select role from control."user" where id = $1', [vet.userId])).rows[0]?.role).toBe(
      'staff',
    )
  })
})
