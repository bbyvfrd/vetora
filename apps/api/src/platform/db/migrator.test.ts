import { rmSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { CONTROL_MIGRATIONS_FOLDER, MIGRATE_LOCK_KEY, migrate, PRACTICE_MIGRATIONS_FOLDER } from './migrator.js'
import {
  captureLog,
  controlSet,
  databaseTestsEnabled,
  practiceSet,
  provisionTestPractice,
  recordedMigrations,
  resetTestDatabase,
  type TestDatabaseUrls,
  tableExists,
  testDatabaseUrls,
  withExtraMigration,
} from './test-support.js'

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

    expect(outcome).toEqual({ status: 'dry-run', pending: controlSet(), practices: [] })
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
    const folder = withExtraMigration(
      CONTROL_MIGRATIONS_FOLDER,
      '20991231235959_boom',
      'CREATE TABLE "control"."boom" ("id" int);\n--> statement-breakpoint\nselect 1/0;\n',
    )
    const { log, lines } = captureLog()
    try {
      const outcome = await migrate({ url: urls.migrator, controlFolder: folder, log })

      expect(outcome).toMatchObject({
        status: 'failed',
        schema: 'control',
        step: 'migrations',
        pending: ['20991231235959_boom'],
      })
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
        // No shadowing of tables through temporary ones: TEMP is revoked from the app role (spec 0002, Security model).
        await expect(app.query('create temp table shadow (id int)')).rejects.toMatchObject(denied)
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

  describe('the practice loop, with the control set applied', () => {
    const extra = '20991231235959_extra'
    // One more migration on a registered table: a new table would need its class in table-classes.ts (grants.test.ts).
    const extraSql = 'ALTER TABLE "location" ADD COLUMN "extra" text;\n'

    beforeEach(async () => {
      await migrate({ url: urls.migrator })
    })

    /** A practice registered by hand, with its role and an empty schema: the whole practice set behind. */
    async function registerByHand(
      slug: string,
      schema: string,
    ): Promise<{ slug: string; schema: string; role: string }> {
      const role = `${schema}_role`
      await migrator.query(
        'insert into control.practice (slug, name, schema_name, role_name) values ($1, $2, $3, $4)',
        [slug, 'By hand', schema, role],
      )
      await migrator.query(`create role ${pg.escapeIdentifier(role)} nologin`)
      await migrator.query(`create schema ${pg.escapeIdentifier(schema)} authorization vetora_migrator`)
      return { slug, schema, role }
    }

    const extraColumnExists = async (schema: string) =>
      (
        await migrator.query(
          "select 1 from information_schema.columns where table_schema = $1 and table_name = 'location' and column_name = 'extra'",
          [schema],
        )
      ).rowCount === 1
    const roleReads = async (role: string, schema: string) =>
      (
        await migrator.query(
          `select has_schema_privilege($1, $2, 'USAGE') as usage, has_table_privilege($1, $3, 'SELECT') as "select"`,
          [role, schema, `${pg.escapeIdentifier(schema)}.practice_settings`],
        )
      ).rows[0]

    it('applies pending practice migrations to every registered schema in registry order, a practice behind catching up in order, the grants pass inside each transaction (AC-10)', async () => {
      const alfa = await provisionTestPractice(urls, { slug: 'alfa' })
      const beta = await registerByHand('beta', 'p_beta')
      const folder = withExtraMigration(PRACTICE_MIGRATIONS_FOLDER, extra, extraSql)
      const { log, lines } = captureLog()
      try {
        const outcome = await migrate({ url: urls.migrator, practiceFolder: folder, log })

        expect(outcome).toEqual({
          status: 'applied',
          applied: [],
          practices: [
            { slug: 'alfa', schema: alfa.schema, applied: [extra] },
            { slug: 'beta', schema: 'p_beta', applied: [...practiceSet(), extra] },
          ],
        })
        expect(await recordedMigrations(migrator, alfa.schema)).toEqual([...practiceSet(), extra])
        expect(await recordedMigrations(migrator, 'p_beta')).toEqual([...practiceSet(), extra])
        expect(await extraColumnExists(alfa.schema)).toBe(true)
        expect(await tableExists(migrator, 'p_beta', 'practice_settings')).toBe(true)
        expect(await roleReads(beta.role, 'p_beta')).toEqual({ usage: true, select: true })
        // Control first, then each practice in registry order, its grants right after its batch.
        const order = lines
          .filter((line) => ['nothing to do', 'applied', 'grants applied'].includes(String(line.msg)))
          .map((line) => `${line.schema}: ${line.msg}`)
        expect(order).toEqual([
          'control: nothing to do',
          `${alfa.schema}: applied`,
          `${alfa.schema}: grants applied`,
          ...practiceSet().map(() => 'p_beta: applied'),
          'p_beta: applied',
          'p_beta: grants applied',
        ])
      } finally {
        rmSync(folder, { recursive: true, force: true })
      }
    })

    it('changes nothing on a second run: every schema reports nothing to do', async () => {
      const alfa = await provisionTestPractice(urls, { slug: 'alfa' })
      const beta = await provisionTestPractice(urls, { slug: 'beta' })
      const before = [await recordedMigrations(migrator, alfa.schema), await recordedMigrations(migrator, beta.schema)]
      const { log, lines } = captureLog()

      const outcome = await migrate({ url: urls.migrator, log })

      expect(outcome).toEqual({
        status: 'applied',
        applied: [],
        practices: [
          { slug: 'alfa', schema: alfa.schema, applied: [] },
          { slug: 'beta', schema: beta.schema, applied: [] },
        ],
      })
      expect([
        await recordedMigrations(migrator, alfa.schema),
        await recordedMigrations(migrator, beta.schema),
      ]).toEqual(before)
      expect(lines.filter((line) => line.msg === 'nothing to do').map((line) => line.schema)).toEqual([
        'control',
        alfa.schema,
        beta.schema,
      ])
    })

    it('limits the run to one practice after control with --practice <slug>, and reports a slug that is not registered', async () => {
      const alfa = await provisionTestPractice(urls, { slug: 'alfa' })
      const beta = await provisionTestPractice(urls, { slug: 'beta' })
      const folder = withExtraMigration(PRACTICE_MIGRATIONS_FOLDER, extra, extraSql)
      try {
        const outcome = await migrate({ url: urls.migrator, practiceFolder: folder, practice: 'beta' })

        expect(outcome).toEqual({
          status: 'applied',
          applied: [],
          practices: [{ slug: 'beta', schema: beta.schema, applied: [extra] }],
        })
        expect(await recordedMigrations(migrator, alfa.schema)).toEqual(practiceSet())
        expect(await recordedMigrations(migrator, beta.schema)).toEqual([...practiceSet(), extra])
        expect(await migrate({ url: urls.migrator, practiceFolder: folder, practice: 'gamma' })).toEqual({
          status: 'not-registered',
          slug: 'gamma',
        })
      } finally {
        rmSync(folder, { recursive: true, force: true })
      }
    })

    it("lists each practice's pending migrations on a dry run and changes nothing", async () => {
      const alfa = await provisionTestPractice(urls, { slug: 'alfa' })
      const beta = await registerByHand('beta', 'p_beta')
      const folder = withExtraMigration(PRACTICE_MIGRATIONS_FOLDER, extra, extraSql)
      try {
        const outcome = await migrate({ url: urls.migrator, practiceFolder: folder, dryRun: true })

        expect(outcome).toEqual({
          status: 'dry-run',
          pending: [],
          practices: [
            { slug: 'alfa', schema: alfa.schema, pending: [extra] },
            { slug: 'beta', schema: 'p_beta', pending: [...practiceSet(), extra] },
          ],
        })
        expect(await recordedMigrations(migrator, alfa.schema)).toEqual(practiceSet())
        expect(await tableExists(migrator, 'p_beta', 'practice_settings')).toBe(false)
        // No grants pass either: the role has nothing yet.
        const usage = await migrator.query("select has_schema_privilege($1, 'p_beta', 'USAGE') as usage", [beta.role])
        expect(usage.rows).toEqual([{ usage: false }])
      } finally {
        rmSync(folder, { recursive: true, force: true })
      }
    })

    it("stops at the first failing practice: practice 1 migrated, practice 2's migrations table unchanged (AC-10)", async () => {
      const alfa = await provisionTestPractice(urls, { slug: 'alfa' })
      const beta = await provisionTestPractice(urls, { slug: 'beta' })
      // One more migration that raises only inside the second practice's schema.
      const folder = withExtraMigration(
        PRACTICE_MIGRATIONS_FOLDER,
        extra,
        `${extraSql}--> statement-breakpoint\nDO $$ BEGIN IF current_schema() = '${beta.schema}' THEN RAISE EXCEPTION 'boom at practice 2'; END IF; END $$;\n`,
      )
      const { log, lines } = captureLog()
      try {
        const outcome = await migrate({ url: urls.migrator, practiceFolder: folder, log })

        expect(outcome).toEqual({
          status: 'failed',
          schema: beta.schema,
          step: 'migrations',
          pending: [extra],
          error: expect.anything(),
        })
        expect(await recordedMigrations(migrator, alfa.schema)).toEqual([...practiceSet(), extra])
        expect(await extraColumnExists(alfa.schema)).toBe(true)
        expect(await recordedMigrations(migrator, beta.schema)).toEqual(practiceSet())
        expect(await extraColumnExists(beta.schema)).toBe(false)
        const failure = lines.find((line) => line.msg === 'migration failed, batch rolled back')
        expect(failure).toMatchObject({ schema: beta.schema, slug: 'beta', pending: [extra], err: { code: 'P0001' } })
      } finally {
        rmSync(folder, { recursive: true, force: true })
      }
    })
  })
})
