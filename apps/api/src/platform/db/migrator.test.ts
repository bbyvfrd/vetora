import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import pg from 'pg'
import { pino } from 'pino'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { CONTROL_MIGRATIONS_FOLDER, MIGRATE_LOCK_KEY, migrate } from './migrator.js'
import { databaseTestsEnabled, resetTestDatabase, type TestDatabaseUrls, testDatabaseUrls } from './test-support.js'

/** The control set as drizzle-kit lays it out: one folder per migration, applied in name order (spec 0001, "Migrations"). */
const controlSet = () => readdirSync(CONTROL_MIGRATIONS_FOLDER).sort()

/** A pino logger whose JSON lines land in an array, so a test can read what migrate logged. */
function captureLog() {
  const lines: Array<Record<string, unknown>> = []
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of String(chunk).split('\n')) {
        if (line.trim()) lines.push(JSON.parse(line))
      }
      callback()
    },
  })
  return { log: pino({ level: 'info' }, sink), lines }
}

describe.skipIf(!databaseTestsEnabled())('migrate brings up the control schema (AC-10)', () => {
  let urls: TestDatabaseUrls
  let migrator: pg.Client

  beforeAll(async () => {
    urls = testDatabaseUrls()
    migrator = new pg.Client({ connectionString: urls.migrator, application_name: 'migrator.test' })
    await migrator.connect()
  })

  afterAll(async () => {
    await migrator.end()
  })

  beforeEach(async () => {
    await resetTestDatabase(urls)
  })

  /** Which of the two schemas the control set creates exist. */
  async function schemasPresent(): Promise<string[]> {
    const result = await migrator.query<{ nspname: string }>(
      "select nspname from pg_namespace where nspname in ('control', 'ext') order by nspname",
    )
    return result.rows.map((row) => row.nspname)
  }

  it('applies the control set to an empty database: control, ext with its three extensions, control.practice', async () => {
    const { log, lines } = captureLog()

    const outcome = await migrate({ url: urls.migrator, log })

    expect(outcome).toMatchObject({ status: 'applied', applied: controlSet() })
    // One line per migration, with its name; never the connection string or its password.
    expect(lines.filter((line) => line.msg === 'applied').map((line) => line.migration)).toEqual(controlSet())
    expect(JSON.stringify(lines)).not.toContain('vetora_migrator:')
    expect(await schemasPresent()).toEqual(['control', 'ext'])
    const extensions = await migrator.query<{ extname: string; schema: string }>(
      `select e.extname, n.nspname as schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace
       where e.extname in ('btree_gist', 'pg_trgm', 'unaccent') order by e.extname`,
    )
    expect(extensions.rows).toEqual([
      { extname: 'btree_gist', schema: 'ext' },
      { extname: 'pg_trgm', schema: 'ext' },
      { extname: 'unaccent', schema: 'ext' },
    ])
    const registry = await migrator.query('select * from control.practice')
    expect(registry.rows).toEqual([])
  })

  it('applies nothing on a second run: control.__drizzle_migrations unchanged, nothing to do', async () => {
    await migrate({ url: urls.migrator })
    const recorded = () => migrator.query('select id, name, hash from control.__drizzle_migrations order by id')
    const before = await recorded()
    const { log, lines } = captureLog()

    const outcome = await migrate({ url: urls.migrator, log })

    expect(outcome).toMatchObject({ status: 'applied', applied: [] })
    expect((await recorded()).rows).toEqual(before.rows)
    expect(before.rows.map((row) => row.name)).toEqual(controlSet())
    expect(lines.map((line) => line.msg)).toContain('nothing to do')
  })

  it('lists the pending migrations on a dry run and leaves an empty database empty', async () => {
    const outcome = await migrate({ url: urls.migrator, dryRun: true })

    expect(outcome).toEqual({ status: 'dry-run', pending: controlSet() })
    expect(await schemasPresent()).toEqual([])
  })

  it('reports lock-held within a second and applies nothing while another session holds the migrate lock', async () => {
    const holder = new pg.Client({ connectionString: urls.migrator, application_name: 'migrator.test holder' })
    await holder.connect()
    try {
      await holder.query('select pg_advisory_lock($1)', [MIGRATE_LOCK_KEY])
      const started = performance.now()

      const outcome = await migrate({ url: urls.migrator })

      expect(outcome).toEqual({ status: 'lock-held' })
      expect(performance.now() - started).toBeLessThan(1000)
      expect(await schemasPresent()).toEqual([])
    } finally {
      await holder.end()
    }
  })

  it('rolls a failing batch back and reports failed: the schema and the migrations table stay as they were', async () => {
    await migrate({ url: urls.migrator })
    // The control set plus one migration that creates a table and then fails, in a temporary folder.
    const folder = mkdtempSync(join(tmpdir(), 'vetora-control-'))
    cpSync(CONTROL_MIGRATIONS_FOLDER, folder, { recursive: true })
    mkdirSync(join(folder, '20991231235959_boom'))
    writeFileSync(
      join(folder, '20991231235959_boom', 'migration.sql'),
      'CREATE TABLE "control"."boom" ("id" int);\n--> statement-breakpoint\nselect 1/0;\n',
    )
    const { log, lines } = captureLog()
    try {
      const outcome = await migrate({ url: urls.migrator, controlFolder: folder, log })

      expect(outcome).toMatchObject({ status: 'failed', pending: ['20991231235959_boom'] })
      const boom = await migrator.query("select to_regclass('control.boom') as found")
      expect(boom.rows[0]).toEqual({ found: null })
      const recorded = await migrator.query('select name from control.__drizzle_migrations order by id')
      expect(recorded.rows.map((row) => row.name)).toEqual(controlSet())
      // The failure is logged with the Postgres error code and the batch, scrubbed (spec 0001, "API conventions").
      const failure = lines.find((line) => line.msg === 'migration failed, batch rolled back')
      expect(failure).toMatchObject({ pending: ['20991231235959_boom'], err: { code: '22012' } })
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })

  describe('after the control set is applied', () => {
    beforeEach(async () => {
      await migrate({ url: urls.migrator })
    })

    it('lets vetora_app read the registry and nothing more; vetora_backup reads it too (spec 0002, Security model)', async () => {
      const app = new pg.Client({ connectionString: urls.app, application_name: 'migrator.test app' })
      await app.connect()
      try {
        expect((await app.query('select * from control.practice')).rows).toEqual([])
        const denied = { code: '42501' }
        await expect(
          app.query(
            "insert into control.practice (slug, name, schema_name, role_name) values ('alfa', 'Alfa Vet', 'p_alfa', 'p_alfa_role')",
          ),
        ).rejects.toMatchObject(denied)
        await expect(app.query("update control.practice set name = 'Other'")).rejects.toMatchObject(denied)
        await expect(app.query('delete from control.practice')).rejects.toMatchObject(denied)
        await expect(app.query('select * from control.__drizzle_migrations')).rejects.toMatchObject(denied)
        await expect(app.query("select ext.unaccent_immutable('Café')")).rejects.toMatchObject(denied)
      } finally {
        await app.end()
      }
      // The backup role reads everything in control for its dumps, the migrations table and its sequence included.
      const backup = await migrator.query(
        `select has_schema_privilege('vetora_backup', 'control', 'USAGE') as usage,
                has_table_privilege('vetora_backup', 'control.practice', 'SELECT') as practice,
                has_table_privilege('vetora_backup', 'control.__drizzle_migrations', 'SELECT') as migrations,
                has_sequence_privilege('vetora_backup', 'control.__drizzle_migrations_id_seq', 'SELECT') as sequence,
                has_table_privilege('vetora_backup', 'control.practice', 'INSERT') as insert`,
      )
      expect(backup.rows[0]).toEqual({ usage: true, practice: true, migrations: true, sequence: true, insert: false })
    })

    it('control.practice issues UUID v7 ids, starts in provisioning, keeps slug, schema_name and role_name unique, and checks status', async () => {
      const alfa = await migrator.query<{ id: string; status: string }>(
        "insert into control.practice (slug, name, schema_name, role_name) values ('alfa', 'Alfa Vet', 'p_alfa', 'p_alfa_role') returning id, status",
      )
      expect(alfa.rows[0]).toEqual({
        status: 'provisioning',
        id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/),
      })
      const another = (slug: string, schemaName: string, roleName: string, status = 'provisioning') =>
        migrator.query(
          'insert into control.practice (slug, name, schema_name, role_name, status) values ($1, $2, $3, $4, $5)',
          [slug, 'Another', schemaName, roleName, status],
        )
      const unique = { code: '23505' }
      await expect(another('alfa', 'p_other', 'p_other_role')).rejects.toMatchObject(unique)
      await expect(another('other', 'p_alfa', 'p_other_role')).rejects.toMatchObject(unique)
      await expect(another('other', 'p_other', 'p_alfa_role')).rejects.toMatchObject(unique)
      await expect(another('other', 'p_other', 'p_other_role', 'bogus')).rejects.toMatchObject({ code: '23514' })
    })

    it('ext.unaccent_immutable strips accents and can sit in an index expression (spec 0001, Search)', async () => {
      expect((await migrator.query("select ext.unaccent_immutable('Café') as value")).rows).toEqual([{ value: 'Cafe' }])
      // Postgres refuses a STABLE function here ("functions in index expression must be marked IMMUTABLE").
      await migrator.query('create temp table indexed (name text)')
      await migrator.query('create index on indexed (ext.unaccent_immutable(name))')
      await migrator.query('drop table indexed')
    })
  })
})
