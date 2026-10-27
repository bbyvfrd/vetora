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
import { uuidv7 } from '../platform/ids.js'
import { forgetPractice } from '../platform/practice-registry.js'
import { type ApiPractice, type Login, provisionApiPractice } from '../test-support.js'

/**
 * The request context (#21; spec #18, "The request context"; spec 0001, "Tenancy and data topology"), seam 2: every
 * route under /api/p/:practiceId resolves the session, the membership, the registry row and the location header,
 * checks the route's action against the matrix, and only then runs the handler in one transaction as the actor. A
 * refused request reaches no handler, so the registration it carries leaves no row behind.
 */
describe.skipIf(!databaseTestsEnabled())('the request context of a practice route (#21, seam 2)', () => {
  let urls: TestDatabaseUrls
  let migrator: TestClient
  let app: TestClient
  let alfa: ApiPractice
  let beta: ApiPractice
  let staff: Record<'receptionist' | 'assistant' | 'veterinarian' | 'groomer', Login>
  let dog: string

  beforeAll(async () => {
    urls = testDatabaseUrls()
    await resetTestDatabase(urls)
    await migrate({ url: urls.migrator })
    migrator = await connectTestClient(urls.migrator, 'practice-context.test')
    await migrator.query("select set_config('app.migration', 'practice-context.test', false)")
    app = await connectTestClient(urls.app, 'practice-context.test app')
    alfa = await provisionApiPractice(urls, { name: 'Alfa Vet' })
    beta = await provisionApiPractice(urls, { name: 'Beta Vet' })
    staff = {
      receptionist: await alfa.addStaff('aysel', ['receptionist']),
      assistant: await alfa.addStaff('kamran', ['assistant']),
      veterinarian: await alfa.addStaff('dr.leyla', ['veterinarian']),
      groomer: await alfa.addStaff('nigar', ['groomer']),
    }
    const species = await migrator.query<{ id: string }>(
      `select id from ${ident(alfa.schema)}.species where code = 'dog'`,
    )
    dog = species.rows[0]?.id as string
  }, 60_000)

  afterAll(async () => {
    await alfa?.drop()
    await beta?.drop()
    await migrator?.end()
    await app?.end()
  })

  /** A registration of a new client and a new dog, with fresh ids. */
  const newRegistration = () => ({
    client: {
      type: 'new',
      id: uuidv7(),
      firstName: 'Aysel',
      lastName: 'Məmmədova',
      phone: '+994 50 123 45 67',
      preferredLanguage: 'az',
    },
    patient: { type: 'new', id: uuidv7(), name: 'Şəkər', speciesId: dog, sex: 'female' },
  })

  /** Whether a client row with this id exists in Alfa, or an audit row names it: what a refused request must not leave. */
  async function leftBehind(clientId: string): Promise<boolean> {
    const rows = await migrator.query(
      `select 1 from ${ident(alfa.schema)}.client where id = $1
       union all select 1 from ${ident(alfa.schema)}.audit_event where row_id = $1`,
      [clientId],
    )
    return (rows.rowCount ?? 0) > 0
  }

  /** Send a registration as the request says and expect the status and a problem body; the registration leaves nothing. */
  async function refused(
    status: number,
    send: (body: ReturnType<typeof newRegistration>) => Promise<Response>,
  ): Promise<Record<string, unknown>> {
    const body = newRegistration()
    const response = await send(body)
    expect(response.status).toBe(status)
    expect(response.headers.get('content-type')).toBe('application/problem+json')
    expect(await leftBehind(body.client.id)).toBe(false)
    return (await response.json()) as Record<string, unknown>
  }

  const register = (login: Login | undefined, body: unknown, options = {}) =>
    alfa.request(login, '/registrations', { method: 'PUT', body, ...options })

  it('answers 401 without a session, and reads nothing', async () => {
    await refused(401, (body) => register(undefined, body))
  })

  it("answers 403 for another practice's id, and for an id that names no practice", async () => {
    await refused(403, (body) => register(staff.veterinarian, body, { practiceId: beta.practiceId }))
    await refused(403, (body) => register(staff.veterinarian, body, { practiceId: uuidv7() }))
    await refused(403, (body) => register(staff.veterinarian, body, { practiceId: 'not-a-practice' }))
    // Beta's manager is no member of Alfa either.
    await refused(403, (body) => register(beta.manager, body))
  })

  it('answers 403 for a practice whose registry status is not active, read again once the registry cache is cleared', async () => {
    await migrator.query(`update control.practice set status = 'suspended' where id = $1`, [alfa.practiceId])
    forgetPractice(alfa.practiceId)
    try {
      await refused(403, (body) => register(staff.veterinarian, body))
    } finally {
      await migrator.query(`update control.practice set status = 'active' where id = $1`, [alfa.practiceId])
      forgetPractice(alfa.practiceId)
    }
  })

  it('answers 503 for a practice whose schema is behind the code (spec 0001, "Migrations")', async () => {
    const migrations = `${ident(alfa.schema)}.__drizzle_migrations`
    const last = await migrator.query<{ name: string }>(`select name from ${migrations} order by name desc limit 1`)
    const name = last.rows[0]?.name as string
    // As if the newest migration had not run here yet.
    await migrator.query(`update ${migrations} set name = $1 where name = $2`, ['00000000000000_not_yet', name])
    forgetPractice(alfa.practiceId)
    try {
      await refused(503, (body) => register(staff.veterinarian, body))
    } finally {
      await migrator.query(`update ${migrations} set name = $1 where name = $2`, [name, '00000000000000_not_yet'])
      forgetPractice(alfa.practiceId)
    }
  })

  it("answers 400 without a location header, with another practice's location, and with a closed location of its own", async () => {
    const closed = await asPractice(app, alfa, async (client) => {
      const row = await client.query<{ id: string }>(
        `insert into ${ident(alfa.schema)}.location (name, active) values ('Xətai', false) returning id`,
      )
      return row.rows[0]?.id as string
    })
    await refused(400, (body) => register(staff.veterinarian, body, { location: null }))
    await refused(400, (body) => register(staff.veterinarian, body, { location: 'not-a-location' }))
    await refused(400, (body) => register(staff.veterinarian, body, { location: beta.locationId }))
    await refused(400, (body) => register(staff.veterinarian, body, { location: closed }))
  })

  it("refuses a groomer's session on every route this ticket adds (story 72)", async () => {
    const groomer = staff.groomer
    for (const [path, method, body] of [
      ['/species', 'GET', undefined],
      [`/breeds/${uuidv7()}`, 'PUT', { speciesId: dog, language: 'az', name: 'Qafqaz çoban iti' }],
      ['/clients/lookup', 'POST', { phone: '+994 50 123 45 67' }],
    ] as const) {
      const response = await alfa.request(groomer, path, { method, body })
      expect(response.status, `${method} ${path}`).toBe(403)
    }
    await refused(403, (body) => register(groomer, body))
  })

  it('lets a receptionist, an assistant, a veterinarian and a manager register a client and a pet', async () => {
    for (const login of [staff.receptionist, staff.assistant, staff.veterinarian, alfa.manager]) {
      const body = newRegistration()
      const response = await register(login, body)
      expect(response.status, login.handle).toBe(200)
      expect(await response.json()).toEqual({ clientId: body.client.id, patientId: body.patient.id })
      const audit = await migrator.query<{ actor_id: string }>(
        `select actor_id from ${ident(alfa.schema)}.audit_event where row_id = $1`,
        [body.client.id],
      )
      expect(audit.rows, login.handle).toEqual([{ actor_id: login.userId }])
    }
  })

  it("keeps each practice to its own rows: Beta's manager finds none of Alfa's clients by the phone they share", async () => {
    const body = newRegistration()
    expect((await register(alfa.manager, body)).status).toBe(200)

    const response = await beta.request(beta.manager, '/clients/lookup', {
      method: 'POST',
      body: { phone: body.client.phone },
    })

    expect(response.status).toBe(200)
    expect(((await response.json()) as { clients: unknown[] }).clients).toEqual([])
  })
})
