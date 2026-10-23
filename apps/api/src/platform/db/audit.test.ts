import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ruleErrors, ruleOf } from './errors.js'
import { migrate, PRACTICE_MIGRATIONS_FOLDER } from './migrator.js'
import {
  asPractice,
  databaseTestsEnabled,
  provisionTestPractice,
  resetTestDatabase,
  type TestDatabaseUrls,
  type TestPractice,
  testDatabaseUrls,
  withExtraMigration,
} from './test-support.js'

describe.skipIf(!databaseTestsEnabled())('every write names its actor and lands in audit_event (IN-1, AC-8)', () => {
  let urls: TestDatabaseUrls
  let migrator: pg.Client
  /** vetora_app on vetora_test: what a request sees. */
  let app: pg.Client
  /** One throwaway practice for the file; the cases run in order and each writes rows of its own. */
  let practice: TestPractice
  let schema: string

  beforeAll(async () => {
    urls = testDatabaseUrls()
    await resetTestDatabase(urls)
    await migrate({ url: urls.migrator })
    migrator = new pg.Client({ connectionString: urls.migrator, application_name: 'audit.test' })
    await migrator.connect()
    app = new pg.Client({ connectionString: urls.app, application_name: 'audit.test app' })
    await app.connect()
    practice = await provisionTestPractice(urls)
    schema = pg.escapeIdentifier(practice.schema)
  })

  afterAll(async () => {
    await practice?.drop()
    await migrator.end()
    await app.end()
  })

  /** The audit rows of one row in the order they were written, read through the practice role (its one privilege on audit_event). */
  async function auditOf(rowId: string): Promise<Record<string, unknown>[]> {
    return asPractice(
      app,
      practice,
      async (client) =>
        (
          await client.query(
            `select table_name, row_id, action, actor_id, source, changed, request_id
             from ${schema}.audit_event where row_id = $1 order by id`,
            [rowId],
          )
        ).rows,
    )
  }

  /** A staff member inserted as the manager through the practice role (the mutable class); the sync of slice 1 does the same. */
  async function addStaff(displayName: string, roles: string[]): Promise<string> {
    const id = randomUUID()
    await asPractice(app, practice, (client) =>
      client.query(
        `insert into ${schema}.staff_member (id, display_name, roles, synced_at) values ($1, $2, $3, now())`,
        [id, displayName, roles],
      ),
    )
    return id
  }

  it('IN-1: an insert through the practice role takes created_by and updated_by from app.actor_id, never from the row, and writes one audit_event row naming the actor (AC-8)', async () => {
    const manager = practice.managerId
    const impostor = '11111111-1111-4111-8111-111111111111'

    const { row, json } = await asPractice(app, practice, async (client) => {
      await client.query("select set_config('app.request_id', 'req-1', true)")
      const inserted = await client.query(
        `insert into ${schema}.location (name, created_by, updated_by, version) values ('Yasamal', $1, $1, 7)
         returning id, created_by, updated_by, version, created_at, updated_at`,
        [impostor],
      )
      const stored = await client.query(`select to_jsonb(l) as json from ${schema}.location l where id = $1`, [
        inserted.rows[0]?.id,
      ])
      return { row: inserted.rows[0], json: stored.rows[0]?.json }
    })

    expect(row).toMatchObject({ created_by: manager, updated_by: manager, version: 1 })
    expect(row.created_at).toEqual(row.updated_at)
    // An insert's audit row stores the row as written, the stamped columns included; the request id travels with it.
    expect(await auditOf(row.id)).toEqual([
      {
        table_name: 'location',
        row_id: row.id,
        action: 'insert',
        actor_id: manager,
        source: 'request',
        request_id: 'req-1',
        changed: json,
      },
    ])
    expect(json).toMatchObject({ name: 'Yasamal', created_by: manager, updated_by: manager, version: 1 })
  })

  it('an update bumps version by one, moves updated_at and updated_by to the actor, keeps created_at and created_by even when the statement changes them, and audits the changed columns only (AC-8)', async () => {
    const manager = practice.managerId
    const vet = await addStaff('Dr Vet', ['veterinarian'])
    const created = await asPractice(
      app,
      practice,
      async (client) =>
        (
          await client.query(
            `insert into ${schema}.location (name) values ('Nizami')
             returning id, created_at, created_by, updated_at, updated_by, version`,
          )
        ).rows[0],
    )

    const updated = await asPractice(
      app,
      practice,
      async (client) =>
        (
          await client.query(
            `update ${schema}.location set name = 'Nizami 2', created_at = '2000-01-01', created_by = $2, version = 99
             where id = $1 returning created_at, created_by, updated_at, updated_by, version`,
            [created.id, vet],
          )
        ).rows[0],
      { actor: vet },
    )

    expect(updated).toEqual({
      created_at: created.created_at,
      created_by: manager,
      updated_at: expect.any(Date),
      updated_by: vet,
      version: 2,
    })
    expect(updated.updated_at.getTime()).toBeGreaterThan(created.updated_at.getTime())
    const audit = await auditOf(created.id)
    expect(audit.map((row) => [row.action, row.actor_id, row.source, row.request_id])).toEqual([
      ['insert', manager, 'request', null],
      ['update', vet, 'request', null],
    ])
    // The new values of the columns that changed, the standard columns the trigger moved included, nothing else.
    expect(audit[1]?.changed).toEqual({ name: 'Nizami 2', updated_at: expect.any(String), updated_by: vet, version: 2 })
    // staff_member is audited the same way: the vet's row names the manager who wrote it.
    expect(await auditOf(vet)).toMatchObject([
      { table_name: 'staff_member', action: 'insert', actor_id: manager, changed: { roles: ['veterinarian'] } },
    ])
  })

  it('practice_settings and staff_member updates through the practice role are stamped and audited the same way (AC-8)', async () => {
    const manager = practice.managerId

    const settings = await asPractice(
      app,
      practice,
      async (client) =>
        (
          await client.query(
            `update ${schema}.practice_settings set display_name = 'Renamed' returning id, updated_by, version`,
          )
        ).rows[0],
    )
    const staff = await asPractice(
      app,
      practice,
      async (client) =>
        (
          await client.query(
            `update ${schema}.staff_member set display_name = 'Dr Manager' where id = $1 returning updated_by, version`,
            [manager],
          )
        ).rows[0],
    )

    expect(settings).toMatchObject({ updated_by: manager, version: 2 })
    expect(await auditOf(settings.id)).toMatchObject([
      { table_name: 'practice_settings', action: 'insert', actor_id: manager, source: 'migration:provision-practice' },
      { action: 'update', actor_id: manager, source: 'request', changed: { display_name: 'Renamed', version: 2 } },
    ])
    expect(staff).toEqual({ updated_by: manager, version: 2 })
    expect((await auditOf(manager)).map((row) => [row.action, row.source])).toEqual([
      ['insert', 'migration:provision-practice'],
      ['update', 'request'],
    ])
  })

  it('IN-1: a write through the practice role with app.actor_id unset or empty fails with vetora.no_actor (SQLSTATE VT001) and leaves no row (AC-8)', async () => {
    const noActor = { code: ruleErrors['vetora.no_actor'], message: expect.stringMatching(/^vetora\.no_actor/) }

    for (const actor of [null, '']) {
      const error: unknown = await asPractice(
        app,
        practice,
        (client) => client.query(`insert into ${schema}.location (name) values ('Nobody')`),
        { actor },
      ).catch((caught: unknown) => caught)
      expect(error).toMatchObject(noActor)
      // The code alone maps the failure to its rule, as a handler will (errors.ts).
      expect(ruleOf(error)).toBe('vetora.no_actor')
    }
    await expect(
      asPractice(app, practice, (client) => client.query(`update ${schema}.location set active = false`), {
        actor: '',
      }),
    ).rejects.toMatchObject(noActor)
    const left = await asPractice(
      app,
      practice,
      async (client) =>
        (await client.query(`select count(*)::int as count from ${schema}.location where name = 'Nobody'`)).rows[0]
          ?.count,
    )
    expect(left).toBe(0)
  })

  it('IN-1: a vetora_migrator write with app.migration set and no actor is audited as migration:<name> with no actor, a delete included; with neither it is refused by the check (AC-8)', async () => {
    const count = async () =>
      (await migrator.query(`select count(*)::int as count from ${schema}.location where name like 'By hand%'`)).rows[0]
        ?.count

    // Neither: the audit row fails its check, so the statement fails and nothing lands (nobody writes unattributed rows by hand).
    await expect(migrator.query(`insert into ${schema}.location (name) values ('By hand')`)).rejects.toMatchObject({
      code: '23514',
      constraint: 'audit_event_actor_check',
    })
    expect(await count()).toBe(0)

    // app.migration for the transaction: a migration, or the import revert, the one delete path (spec 0002, Key invariants).
    await migrator.query('begin')
    await migrator.query("select set_config('app.migration', 'audit.test', true)")
    const inserted = (
      await migrator.query(
        `insert into ${schema}.location (name) values ('By hand') returning id, created_by, updated_by, version`,
      )
    ).rows[0]
    await migrator.query(`update ${schema}.location set name = 'By hand 2' where id = $1`, [inserted.id])
    await migrator.query(`delete from ${schema}.location where id = $1`, [inserted.id])
    await migrator.query('commit')

    expect(inserted).toMatchObject({ created_by: null, updated_by: null, version: 1 })
    expect(await count()).toBe(0)
    const audit = await auditOf(inserted.id)
    expect(audit.map((row) => [row.action, row.actor_id, row.source])).toEqual([
      ['insert', null, 'migration:audit.test'],
      ['update', null, 'migration:audit.test'],
      ['delete', null, 'migration:audit.test'],
    ])
    // A delete stores the old row.
    expect(audit[2]?.changed).toMatchObject({ id: inserted.id, name: 'By hand 2', version: 2, created_by: null })
  })

  it('a data migration run by migrate writes rows as migration:practice, or as its own folder name once it sets app.migration at its top (AC-8)', async () => {
    const seed = '20991231235959_seed'
    const folder = withExtraMigration(
      PRACTICE_MIGRATIONS_FOLDER,
      seed,
      [
        "insert into location (name) values ('Seeded by the set');",
        `select set_config('app.migration', '${seed}', true);`,
        "insert into location (name) values ('Seeded by the folder');",
      ].join('\n--> statement-breakpoint\n'),
    )
    try {
      expect(await migrate({ url: urls.migrator, practiceFolder: folder })).toMatchObject({ status: 'applied' })

      const seeded = await asPractice(
        app,
        practice,
        async (client) =>
          (
            await client.query(
              `select l.name, a.source, a.actor_id, l.created_by from ${schema}.audit_event a
               join ${schema}.location l on l.id = a.row_id where l.name like 'Seeded%' order by l.name`,
            )
          ).rows,
      )
      expect(seeded).toEqual([
        { name: 'Seeded by the folder', source: `migration:${seed}`, actor_id: null, created_by: null },
        { name: 'Seeded by the set', source: 'migration:practice', actor_id: null, created_by: null },
      ])
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })

  it('audit_event is written only by the trigger: INSERT, UPDATE, and DELETE through the practice role are permission denied, and a request cannot pass as a migration (AC-8, AC-9)', async () => {
    const manager = practice.managerId
    const denied = { code: '42501' }
    const as = (query: string, values: unknown[] = []) =>
      asPractice(app, practice, (client) => client.query(query, values))

    await expect(
      as(
        `insert into ${schema}.audit_event (table_name, row_id, action, actor_id, source, changed)
         values ('location', uuidv7(), 'insert', $1, 'request', '{}')`,
        [manager],
      ),
    ).rejects.toMatchObject(denied)
    await expect(as(`update ${schema}.audit_event set changed = '{}'`)).rejects.toMatchObject(denied)
    await expect(as(`delete from ${schema}.audit_event`)).rejects.toMatchObject(denied)
    await expect(as(`truncate ${schema}.audit_event`)).rejects.toMatchObject(denied)
    // The owner run functions are not callable by the practice role; the triggers run them (spec 0002, Security model).
    await expect(as(`select ${schema}.current_actor()`)).rejects.toMatchObject(denied)

    // app.migration on a request session is ignored: the source stays request and the actor is still required.
    const forged = await asPractice(app, practice, async (client) => {
      await client.query("select set_config('app.migration', 'forged', true)")
      return (await client.query(`insert into ${schema}.location (name) values ('Forged') returning id`)).rows[0]?.id
    })
    expect(await auditOf(forged)).toMatchObject([{ action: 'insert', source: 'request', actor_id: manager }])
    await expect(
      asPractice(
        app,
        practice,
        async (client) => {
          await client.query("select set_config('app.migration', 'forged', true)")
          await client.query(`insert into ${schema}.location (name) values ('Forged too')`)
        },
        { actor: null },
      ),
    ).rejects.toMatchObject({ code: ruleErrors['vetora.no_actor'] })
  })

  it('staff_member refuses an empty roles array and a role outside the five (AC-10)', async () => {
    const check = { code: '23514', constraint: 'staff_member_roles_check' }

    await expect(addStaff('Nobody', [])).rejects.toMatchObject(check)
    await expect(addStaff('Nobody', ['manager', 'janitor'])).rejects.toMatchObject(check)
    const twoHats = await addStaff('Two hats', ['veterinarian', 'manager'])
    expect(await auditOf(twoHats)).toMatchObject([{ changed: { roles: ['veterinarian', 'manager'], active: true } }])
  })
})
