import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from '../platform/db/migrator.js'
import {
  asPractice,
  connectTestClient,
  databaseTestsEnabled,
  escapeIdentifier as ident,
  resetTestDatabase,
  type TestClient,
  type TestDatabaseUrls,
  testDatabaseUrls,
} from '../platform/db/test-support.js'
import { type ApiPractice, call, type Login, provisionApiPractice } from '../test-support.js'

describe.skipIf(!databaseTestsEnabled())('who is signed in: /api/me and the language route (spec #18, seam 2)', () => {
  let urls: TestDatabaseUrls
  let migrator: TestClient
  let app: TestClient
  let practice: ApiPractice
  let vet: Login
  let desk: Login
  let groomer: Login

  beforeAll(async () => {
    urls = testDatabaseUrls()
    await resetTestDatabase(urls)
    await migrate({ url: urls.migrator })
    migrator = await connectTestClient(urls.migrator, 'me.test')
    app = await connectTestClient(urls.app, 'me.test app')
    practice = await provisionApiPractice(urls, {
      name: 'Alfa Vet',
      locationName: 'Nərimanov',
      languages: ['az', 'ru'],
    })
    vet = await practice.addStaff('dr.leyla', ['veterinarian'], { name: 'Leyla Həsənova' })
    desk = await practice.addStaff('aysel', ['receptionist', 'assistant'], { name: 'Aysel Quliyeva' })
    groomer = await practice.addStaff('nigar', ['groomer'], { name: 'Nigar Əliyeva' })
    // A second active location and a closed one, written as the manager through the practice's role.
    await asPractice(app, practice, async (client) => {
      await client.query(`insert into ${ident(practice.schema)}.location (name) values ('Yasamal')`)
      await client.query(`insert into ${ident(practice.schema)}.location (name, active) values ('Xətai', false)`)
    })
  }, 30_000)

  afterAll(async () => {
    await practice?.drop()
    await migrator?.end()
    await app?.end()
  })

  const me = (login?: Login) => call('/api/me', { cookie: login?.cookie })

  it('answers 401 with problem details without a session, and after the session is signed out (story 27)', async () => {
    const none = await me()
    expect(none.status).toBe(401)
    expect(none.headers.get('content-type')).toBe('application/problem+json')

    const out = await call('/api/auth/sign-out', { method: 'POST', cookie: groomer.cookie })
    expect(out.status).toBe(204)
    expect((await me(groomer)).status).toBe(401)
  })

  it('names the person, their practice with its id, name and code and their roles, and its active locations with the default first and marked (story 27)', async () => {
    const response = await me(vet)

    expect(response.status).toBe(200)
    const body = (await response.json()) as { locations: { id: string }[] }
    expect(body).toEqual({
      id: vet.userId,
      displayName: 'Leyla Həsənova',
      language: 'az',
      practice: { id: practice.practiceId, name: 'Alfa Vet', code: practice.slug, roles: ['veterinarian'] },
      locations: [
        { id: expect.any(String), name: 'Nərimanov', isDefault: true },
        { id: expect.any(String), name: 'Yasamal', isDefault: false },
      ],
    })
    const ids = await migrator.query<{ id: string }>(
      `select id from ${ident(practice.schema)}.location where active order by is_default desc, name`,
    )
    expect(body.locations.map((location) => location.id)).toEqual(ids.rows.map((row) => row.id))
  })

  it('reports every role of a member who holds several, in the order of the five', async () => {
    const body = (await (await me(desk)).json()) as { practice: { roles: string[] } }
    expect(body.practice.roles).toEqual(['assistant', 'receptionist'])
  })

  it('PUT /api/me/language refuses a value outside az, ru and en, and saves a valid one, which the next /api/me and the session return (story 12)', async () => {
    for (const body of [{ language: 'tr' }, { language: '' }, {}]) {
      const refused = await call('/api/me/language', { method: 'PUT', body, cookie: vet.cookie })
      expect(refused.status, JSON.stringify(body)).toBe(400)
      expect(refused.headers.get('content-type')).toBe('application/problem+json')
    }
    expect(((await (await me(vet)).json()) as { language: string }).language).toBe('az')

    const saved = await call('/api/me/language', { method: 'PUT', body: { language: 'ru' }, cookie: vet.cookie })

    expect(saved.status).toBe(204)
    expect(((await (await me(vet)).json()) as { language: string }).language).toBe('ru')
    const session = (await (await call('/api/auth/get-session', { cookie: vet.cookie })).json()) as {
      user: { language: string }
    }
    expect(session.user.language).toBe('ru')
    // The other logins keep theirs.
    expect(((await (await me(desk)).json()) as { language: string }).language).toBe('az')
  })

  it('PUT /api/me/language answers 401 without a session and changes nothing', async () => {
    const refused = await call('/api/me/language', { method: 'PUT', body: { language: 'en' } })
    expect(refused.status).toBe(401)
  })

  it('keeps the membership and the mirror in agreement for every member: control.member.role split on commas equals staff_member.roles as a set (story 22)', async () => {
    const rows = await migrator.query<{ user_id: string; role: string; roles: string[] | null }>(
      `select m.user_id, m.role, s.roles::text[] as roles
       from control.member m left join ${ident(practice.schema)}.staff_member s on s.id = m.user_id
       where m.organization_id = $1 order by m.created_at`,
      [practice.practiceId],
    )

    expect(rows.rows.map((row) => row.user_id)).toEqual([practice.managerId, vet.userId, desk.userId, groomer.userId])
    for (const row of rows.rows) {
      expect(new Set(row.roles ?? []), row.user_id).toEqual(new Set(row.role.split(',')))
    }
    const staff = await migrator.query<{ n: number }>(
      `select count(*)::int as n from ${ident(practice.schema)}.staff_member`,
    )
    expect(staff.rows[0]?.n).toBe(rows.rows.length)
  })
})
