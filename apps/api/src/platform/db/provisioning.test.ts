import { rmSync } from 'node:fs'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { migrate, PRACTICE_MIGRATIONS_FOLDER } from './migrator.js'
import { provisionPractice } from './provisioning.js'
import {
  asPractice,
  captureLog,
  databaseTestsEnabled,
  PERMISSION_DENIED,
  practiceSet,
  provisionTestPractice,
  resetTestDatabase,
  type TestDatabaseUrls,
  type TestPractice,
  testDatabaseUrls,
  UUID_V7,
  withExtraMigration,
} from './test-support.js'

describe.skipIf(!databaseTestsEnabled())(
  'provision-practice creates a practice behind its own role (AC-10, AC-11)',
  () => {
    let urls: TestDatabaseUrls
    let migrator: pg.Client
    /** vetora_app on vetora_test: what the API would see. */
    let app: pg.Client
    /** Every practice a test provisions, dropped after it. */
    const practices: TestPractice[] = []

    beforeAll(async () => {
      urls = testDatabaseUrls()
      await resetTestDatabase(urls)
      await migrate({ url: urls.migrator })
      migrator = new pg.Client({ connectionString: urls.migrator, application_name: 'provisioning.test' })
      await migrator.connect()
      // What this file writes by hand as the migrator is attributed to it (IN-1): audit_row() refuses a migrator write
      // with neither an actor nor app.migration.
      await migrator.query("select set_config('app.migration', 'provisioning.test', false)")
      app = new pg.Client({ connectionString: urls.app, application_name: 'provisioning.test app' })
      await app.connect()
    })

    afterAll(async () => {
      await migrator.end()
      await app.end()
    })

    afterEach(async () => {
      for (const practice of practices.splice(0)) await practice.drop()
    })

    async function provision(options: Parameters<typeof provisionTestPractice>[1] = {}): Promise<TestPractice> {
      const practice = await provisionTestPractice(urls, options)
      practices.push(practice)
      return practice
    }

    /** The role as Postgres holds it: whether it logs in, and vetora_app's membership options. */
    async function membershipOf(role: string) {
      const rows = await migrator.query(
        `select r.rolcanlogin, m.inherit_option, m.set_option from pg_roles r
         join pg_auth_members m on m.roleid = r.oid
         join pg_roles member on member.oid = m.member and member.rolname = 'vetora_app'
         where r.rolname = $1`,
        [role],
      )
      return rows.rows
    }

    /** Everything provisioning leaves behind for a practice, read back as the migrator, to compare two runs. */
    async function stateOf(practice: TestPractice) {
      const schema = pg.escapeIdentifier(practice.schema)
      const registry = await migrator.query('select * from control.practice where id = $1', [practice.practiceId])
      const settings = await migrator.query(`select * from ${schema}.practice_settings`)
      const locations = await migrator.query(`select * from ${schema}.location order by name`)
      const staff = await migrator.query(`select * from ${schema}.staff_member order by id`)
      const audit = await migrator.query(
        `select table_name, row_id, action, actor_id, source, changed from ${schema}.audit_event order by id`,
      )
      const migrations = await migrator.query(`select id, name, hash from ${schema}.__drizzle_migrations order by id`)
      return {
        registry: registry.rows,
        settings: settings.rows,
        locations: locations.rows,
        staff: staff.rows,
        audit: audit.rows,
        migrations: migrations.rows,
        role: await membershipOf(practice.role),
      }
    }

    /** `query` in one request transaction on the vetora_app connection as the practice's manager (asPractice, test-support.ts). */
    const queryAs = <T extends pg.QueryResultRow>(practice: TestPractice, query: string) =>
      asPractice(app, practice, (client) => client.query<T>(query))

    it("creates the registry row, the role and its membership, the schema with the practice set, the manager's staff row, the settings from the arguments, and the default location, each written as the manager, and sets the practice active (AC-8, AC-10)", async () => {
      const { log, lines } = captureLog()

      const alfa = await provision({
        slug: 'alfa',
        name: 'Alfa Vet',
        managerName: 'Dr Aliyeva',
        locationName: 'Nərimanov',
        log,
      })
      const manager = alfa.managerId

      expect(alfa.practiceId).toMatch(UUID_V7)
      const registry = await migrator.query(
        'select slug, name, schema_name, role_name, status from control.practice where id = $1',
        [alfa.practiceId],
      )
      // Spec 0002, "Value sourcing": the schema is p_ plus the id, the role that plus _role.
      expect(registry.rows).toEqual([
        {
          slug: 'alfa',
          name: 'Alfa Vet',
          schema_name: `p_${alfa.practiceId}`,
          role_name: `p_${alfa.practiceId}_role`,
          status: 'active',
        },
      ])
      // The role never logs in; vetora_app is a member without inheriting and with the right to set it (spec 0002, Roles).
      expect(await membershipOf(alfa.role)).toEqual([{ rolcanlogin: false, inherit_option: false, set_option: true }])
      const schema = await migrator.query(
        'select pg_get_userbyid(nspowner) as owner from pg_namespace where nspname = $1',
        [alfa.schema],
      )
      expect(schema.rows).toEqual([{ owner: 'vetora_migrator' }])
      const recorded = await migrator.query(
        `select name from ${pg.escapeIdentifier(alfa.schema)}.__drizzle_migrations order by id`,
      )
      expect(recorded.rows.map((row) => row.name)).toEqual(practiceSet())
      const tables = await migrator.query(
        'select table_name from information_schema.tables where table_schema = $1 order by table_name',
        [alfa.schema],
      )
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        '__drizzle_migrations',
        'audit_event',
        'location',
        'practice_settings',
        'staff_member',
      ])
      // The first manager mirrors the control user id given, with the one role; the row is its own creator (IN-1).
      const staff = await migrator.query(
        `select id, display_name, roles, active, synced_at, created_by, updated_by, version
         from ${pg.escapeIdentifier(alfa.schema)}.staff_member`,
      )
      expect(staff.rows).toEqual([
        {
          id: manager,
          display_name: 'Dr Aliyeva',
          roles: ['manager'],
          active: true,
          synced_at: expect.any(Date),
          created_by: manager,
          updated_by: manager,
          version: 1,
        },
      ])
      const settings = await migrator.query(
        `select legal_name, display_name, address, phone, tax_id, time_zone, currency, languages::text[] as languages,
              default_language, care_relationship_lapse_months, backdate_limit_hours, delegation_enabled, go_live_at,
              created_by, updated_by, version
       from ${pg.escapeIdentifier(alfa.schema)}.practice_settings`,
      )
      expect(settings.rows).toEqual([
        {
          legal_name: 'Alfa Vet',
          display_name: 'Alfa Vet',
          address: null,
          phone: null,
          tax_id: null,
          time_zone: 'Asia/Baku',
          currency: 'AZN',
          languages: ['az', 'ru'],
          default_language: 'az',
          care_relationship_lapse_months: 12,
          backdate_limit_hours: 24,
          delegation_enabled: true,
          go_live_at: null,
          created_by: manager,
          updated_by: manager,
          version: 1,
        },
      ])
      const locations = await migrator.query(
        `select name, address, phone, is_default, active, created_by, updated_by, version
         from ${pg.escapeIdentifier(alfa.schema)}.location`,
      )
      expect(locations.rows).toEqual([
        {
          name: 'Nərimanov',
          address: null,
          phone: null,
          is_default: true,
          active: true,
          created_by: manager,
          updated_by: manager,
          version: 1,
        },
      ])
      // Three inserts in the audit log, the manager as actor, the command as source (AC-8).
      const audit = await migrator.query(
        `select table_name, action, actor_id, source from ${pg.escapeIdentifier(alfa.schema)}.audit_event order by id`,
      )
      expect(audit.rows).toEqual([
        { table_name: 'staff_member', action: 'insert', actor_id: manager, source: 'migration:provision-practice' },
        {
          table_name: 'practice_settings',
          action: 'insert',
          actor_id: manager,
          source: 'migration:provision-practice',
        },
        { table_name: 'location', action: 'insert', actor_id: manager, source: 'migration:provision-practice' },
      ])
      // The log carries the slug and the ids, never the names (spec 0002, "Security model": personal data).
      const logged = JSON.stringify(lines)
      expect(logged).toContain(alfa.practiceId)
      expect(logged).toContain(manager)
      expect(logged).not.toContain('Alfa Vet')
      expect(logged).not.toContain('Nərimanov')
      expect(logged).not.toContain('Dr Aliyeva')
    })

    it('changes nothing on a rerun with the same slug and name, the manager row and the audit log included, even with another manager (AC-10)', async () => {
      const alfa = await provision({ slug: 'alfa', name: 'Alfa Vet', locationName: 'Nərimanov' })
      const before = await stateOf(alfa)
      expect(before.staff).toHaveLength(1)
      expect(before.audit).toHaveLength(3)

      const again = await provisionTestPractice(urls, {
        slug: 'alfa',
        name: 'Alfa Vet',
        managerName: 'Someone else',
        locationName: 'Elsewhere',
      })

      expect(again.practiceId).toBe(alfa.practiceId)
      expect(await stateOf(alfa)).toEqual(before)
    })

    it('completes a rerun after a step was undone, status back to provisioning and the settings row deleted, writing the row as the first manager even when the rerun names another (AC-10)', async () => {
      const alfa = await provision({ slug: 'alfa', name: 'Alfa Vet', locationName: 'Nərimanov' })
      const before = await stateOf(alfa)
      await migrator.query("update control.practice set status = 'provisioning' where id = $1", [alfa.practiceId])
      await migrator.query(`delete from ${pg.escapeIdentifier(alfa.schema)}.practice_settings`)

      // A fresh manager id: not a staff member, so the row can only be written as the first manager (IN-1).
      const again = await provisionTestPractice(urls, { slug: 'alfa', name: 'Alfa Vet', locationName: 'Nərimanov' })

      expect(again.practiceId).toBe(alfa.practiceId)
      expect(again.managerId).not.toBe(alfa.managerId)
      const after = await stateOf(alfa)
      expect(after.registry.map((row) => row.status)).toEqual(['active'])
      // The settings row is written again as the first manager; only the clock columns differ.
      const withoutClock = (rows: Record<string, unknown>[]) => rows.map(({ created_at, updated_at, ...row }) => row)
      expect(withoutClock(after.settings)).toEqual(withoutClock(before.settings))
      expect(after.locations).toEqual(before.locations)
      expect(after.staff).toEqual(before.staff)
      expect(after.migrations).toEqual(before.migrations)
      // The hand delete and the rerun's insert are both in the audit log, each attributed (IN-1).
      expect(after.audit.slice(3).map((row) => [row.table_name, row.action, row.actor_id, row.source])).toEqual([
        ['practice_settings', 'delete', null, 'migration:provisioning.test'],
        ['practice_settings', 'insert', alfa.managerId, 'migration:provision-practice'],
      ])
    })

    it('leaves a provisioning row when the practice set fails, which a rerun with the committed set completes (AC-10)', async () => {
      // A practice set whose last migration fails: Drizzle rolls the batch back and the registry row stays as written first.
      const folder = withExtraMigration(PRACTICE_MIGRATIONS_FOLDER, '20991231235959_boom', 'select 1/0;\n')
      try {
        const failed = await provisionPractice({
          url: urls.migrator,
          input: {
            slug: 'gamma',
            name: 'Gamma Vet',
            managerUserId: '11111111-1111-7111-8111-111111111111',
            managerName: 'Dr Gamma',
            locationName: 'Main',
            timeZone: 'Asia/Baku',
            languages: ['az'],
          },
          practiceFolder: folder,
        })

        // A new schema has the whole set pending, so the rolled back batch is the committed set plus the failing migration.
        expect(failed).toMatchObject({
          status: 'failed',
          step: 'migrations',
          pending: [...practiceSet(), '20991231235959_boom'],
        })
        const registry = await migrator.query('select status from control.practice where slug = $1', ['gamma'])
        expect(registry.rows).toEqual([{ status: 'provisioning' }])

        const gamma = await provision({ slug: 'gamma', name: 'Gamma Vet' })

        const after = await stateOf(gamma)
        expect(after.registry.map((row) => row.status)).toEqual(['active'])
        expect(after.migrations.map((row) => row.name)).toEqual(practiceSet())
        expect(after.settings).toHaveLength(1)
      } finally {
        rmSync(folder, { recursive: true, force: true })
      }
    })

    it('refuses the slug of a practice with another name and changes nothing (AC-10)', async () => {
      const alfa = await provision({ slug: 'alfa', name: 'Alfa Vet', locationName: 'Nərimanov' })
      const before = await stateOf(alfa)
      const schemasBefore = await migrator.query(
        "select count(*)::int as count from pg_namespace where nspname like 'p\\_%'",
      )
      const { log, lines } = captureLog()

      const outcome = await provisionPractice({
        url: urls.migrator,
        input: {
          slug: 'alfa',
          name: 'Someone else',
          managerUserId: alfa.managerId,
          managerName: 'Dr Else',
          locationName: 'Elsewhere',
          timeZone: 'Asia/Baku',
          languages: ['az'],
        },
        log,
      })

      expect(outcome).toEqual({ status: 'slug-taken', slug: 'alfa' })
      expect(await stateOf(alfa)).toEqual(before)
      expect(
        await migrator.query("select count(*)::int as count from pg_namespace where nspname like 'p\\_%'"),
      ).toMatchObject({
        rows: schemasBefore.rows,
      })
      expect(JSON.stringify(lines)).not.toContain('Someone else')
      expect(JSON.stringify(lines)).not.toContain('Dr Else')
    })

    it('isolates practices: vetora_app reads a practice table only after SET LOCAL ROLE to its role, and never another practice (AC-11)', async () => {
      const alfa = await provision({ name: 'Alfa Vet' })
      const beta = await provision({ name: 'Beta Vet' })
      const settingsOf = (practice: TestPractice) =>
        `select display_name from ${pg.escapeIdentifier(practice.schema)}.practice_settings`

      // No role switch: a schema qualified SELECT is permission denied.
      await expect(app.query(settingsOf(alfa))).rejects.toMatchObject(PERMISSION_DENIED)
      // As practice A: A's tables read, B's are permission denied.
      expect((await queryAs(alfa, settingsOf(alfa))).rows).toEqual([{ display_name: 'Alfa Vet' }])
      await expect(queryAs(alfa, settingsOf(beta))).rejects.toMatchObject(PERMISSION_DENIED)
      // vetora_app holds no grant of its own on any practice table (spec 0002, "Security model": Roles).
      const own = await migrator.query(
        `select has_schema_privilege('vetora_app', $1, 'USAGE') as usage, has_table_privilege('vetora_app', $2, 'SELECT') as "select"`,
        [alfa.schema, `${pg.escapeIdentifier(alfa.schema)}.practice_settings`],
      )
      expect(own.rows).toEqual([{ usage: false, select: false }])
    })

    it('lets vetora_backup read every practice table for dumps (spec 0002, Security model)', async () => {
      const alfa = await provision()
      const schema = pg.escapeIdentifier(alfa.schema)

      const backup = await migrator.query(
        `select has_schema_privilege('vetora_backup', $1, 'USAGE') as usage,
              has_table_privilege('vetora_backup', $2, 'SELECT') as settings,
              has_table_privilege('vetora_backup', $3, 'SELECT') as location,
              has_table_privilege('vetora_backup', $4, 'SELECT') as migrations,
              has_table_privilege('vetora_backup', $2, 'INSERT') as insert`,
        [alfa.schema, `${schema}.practice_settings`, `${schema}.location`, `${schema}.__drizzle_migrations`],
      )

      expect(backup.rows).toEqual([{ usage: true, settings: true, location: true, migrations: true, insert: false }])
    })

    it('practice_settings holds exactly one row and refuses a language outside az, ru, en, a currency other than AZN, and a fractional minor_units (AC-9, AC-13)', async () => {
      const alfa = await provision()
      const schema = pg.escapeIdentifier(alfa.schema)
      const settings = `${schema}.practice_settings`

      // A second row: with the constant id it is a duplicate key, with any other id the check refuses it.
      await expect(
        migrator.query(`insert into ${settings} (legal_name, display_name, default_language) values ('X', 'X', 'az')`),
      ).rejects.toMatchObject({ code: '23505' })
      await expect(
        migrator.query(
          `insert into ${settings} (id, legal_name, display_name, default_language) values (uuidv7(), 'X', 'X', 'az')`,
        ),
      ).rejects.toMatchObject({ code: '23514' })
      const checkViolation = { code: '23514' }
      await expect(migrator.query(`update ${settings} set default_language = 'tr'`)).rejects.toMatchObject(
        checkViolation,
      )
      await expect(migrator.query(`update ${settings} set languages = '{az,tr}'`)).rejects.toMatchObject(checkViolation)
      await expect(migrator.query(`update ${settings} set currency = 'USD'`)).rejects.toMatchObject(checkViolation)
      expect(
        (
          await migrator.query(
            `update ${settings} set default_language = 'en', languages = '{az,ru,en}' returning default_language`,
          )
        ).rows,
      ).toEqual([{ default_language: 'en' }])
      // IN-4: the domain is a bigint, so a bound value with a fraction (how the API sends values) is refused; a numeric
      // literal in SQL is rounded, as for any bigint.
      const minorUnits = `select $1::${schema}.minor_units as value`
      expect((await migrator.query(minorUnits, ['150'])).rows).toEqual([{ value: '150' }])
      await expect(migrator.query(minorUnits, ['1.5'])).rejects.toMatchObject({ code: '22P02' })
    })

    it('keeps one default location per practice and lets the practice role DELETE from neither table (AC-9, IN-6)', async () => {
      const alfa = await provision()
      const schema = pg.escapeIdentifier(alfa.schema)

      await expect(
        migrator.query(`insert into ${schema}.location (name, is_default) values ('Second', true)`),
      ).rejects.toMatchObject({ code: '23505' })
      await migrator.query(`insert into ${schema}.location (name, is_default) values ('Second', false)`)
      await expect(queryAs(alfa, `delete from ${schema}.location`)).rejects.toMatchObject(PERMISSION_DENIED)
      await expect(queryAs(alfa, `delete from ${schema}.practice_settings`)).rejects.toMatchObject(PERMISSION_DENIED)
      await expect(queryAs(alfa, `truncate ${schema}.location`)).rejects.toMatchObject(PERMISSION_DENIED)
      await expect(queryAs(alfa, `delete from ${schema}.staff_member`)).rejects.toMatchObject(PERMISSION_DENIED)
      // The practice role reads and writes the mutable tables (spec 0002, "Conventions": Table classes).
      expect(
        (await queryAs(alfa, `update ${schema}.location set active = false where name = 'Second' returning active`))
          .rows,
      ).toEqual([{ active: false }])
    })
  },
)
