import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ruleErrors } from './platform/db/errors.js'
import { MIGRATE_LOCK_KEY } from './platform/db/migrator.js'
import { MIGRATIONS_TABLE, tableClassRegistry } from './platform/db/table-classes.js'
import {
  asPractice,
  connectTestClient,
  controlSet,
  createRulesFixture,
  databaseTestsEnabled,
  dropTestPractice,
  escapeIdentifier as ident,
  PERMISSION_DENIED,
  practiceSet,
  recordedMigrations,
  resetTestDatabase,
  TEST_PASSWORD,
  type TestClient,
  type TestDatabaseUrls,
  testDatabaseUrls,
  UUID_V7,
} from './platform/db/test-support.js'
import { type Command, type CommandRun, commandEnv, runCommand as runShipped } from './test-support.js'

/**
 * The two practice rehearsal (spec 0002, build plan step 6, and its "Critical test scenarios": Happy path, Isolation,
 * Permission, Checks, Migration order; spec 0001 "Tenancy": a test with two practices proves neither sees the other).
 * The shipped commands run as subprocesses against vetora_test, the way `kamal app exec` runs them on a server
 * (`node --import=tsx src/<command>.ts` here, `node apps/api/dist/<command>.js` in the image), with the exit code of
 * every run asserted; the checks go through vetora_app connections, what a request sees. Nothing reaches the engines
 * directly, so a regression in an entry point, its exit codes, or its environment handling fails here and nowhere
 * else. docs/specs/0002-data-model/verify.md is the same walk by hand, with the results observed. The cases are one
 * walk in order (the later ones address the practices the earlier ones provisioned), so the file runs whole: a `-t`
 * filter skips the provisioning they need.
 */

/** pino's numeric levels, as the log lines carry them. */
const LEVEL = { warn: 40, error: 50, fatal: 60 } as const

/** Every run of the file, for the hygiene check at the end: nothing a command printed may carry the URL or a name. */
const runs: CommandRun[] = []

/** One shipped command as a subprocess (test-support.ts), kept for the hygiene check. */
async function runCommand(
  command: Command,
  args: string[],
  env: Record<string, string>,
  stdin?: string,
): Promise<CommandRun> {
  const run = await runShipped(command, args, env, stdin)
  runs.push(run)
  return run
}

/** A practice as the rehearsal provisions it: the command's arguments, then what it printed and the registry derived. */
type Practice = {
  slug: string
  name: string
  /** The manager's handle, given as --manager-handle; they sign in as `<handle>@<slug>`. */
  managerHandle: string
  /** The login provisioning created for the manager, read back after the run: their staff_member id too. */
  managerId: string
  managerName: string
  locationName: string
  /** The id the command printed, and the schema and role the registry derives from it (spec 0002, "Value sourcing"). */
  id: string
  schema: string
  role: string
}

/** A practice as the registry holds it: what the migrate loop addresses (spec 0002, "Interface surface"). */
type Registered = Pick<Practice, 'slug' | 'name' | 'id' | 'schema' | 'role'>

const alfa: Practice = {
  slug: 'alfa',
  name: 'Alfa Vet',
  managerHandle: 'dr.aliyeva',
  managerId: '',
  managerName: 'Dr Aliyeva',
  locationName: 'Nərimanov',
  id: '',
  schema: '',
  role: '',
}

const beta: Practice = {
  slug: 'beta',
  name: 'Beta Vet',
  managerHandle: 'dr.bayramova',
  managerId: '',
  managerName: 'Dr Bayramova',
  locationName: 'Gənclik',
  id: '',
  schema: '',
  role: '',
}

/** Registered by hand, behind the whole practice set: the shape a restore or a move from another database leaves. */
const gamma: Registered = { slug: 'gamma', name: 'Gamma Vet', id: '', schema: '', role: '' }

describe.skipIf(!databaseTestsEnabled())(
  'the two practice rehearsal through the shipped commands (spec 0002, build plan step 6: AC-8, AC-10, AC-11, AC-13)',
  () => {
    let urls: TestDatabaseUrls
    /** vetora_migrator on vetora_test: reads the catalog and the migrations tables, holds the lock in one case. */
    let migrator: TestClient
    /** vetora_app on vetora_test: what a request sees. */
    let app: TestClient

    beforeAll(async () => {
      urls = testDatabaseUrls()
      await resetTestDatabase(urls)
      migrator = await connectTestClient(urls.migrator, 'rehearsal.test')
      app = await connectTestClient(urls.app, 'rehearsal.test app')
    })

    afterAll(async () => {
      // The practices go the way a throwaway one does, so no schema or cluster wide role outlives the file.
      for (const practice of [alfa, beta, gamma]) {
        if (practice.id) {
          await dropTestPractice(urls, { practiceId: practice.id, schema: practice.schema, role: practice.role })
        }
      }
      await migrator?.end()
      await app?.end()
    })

    /** `migrate` with the test URL, the log at info so a run's lines can be read. */
    const migrate = (args: string[] = []) =>
      runCommand('migrate', args, { DATABASE_URL_MIGRATOR: urls.migrator, LOG_LEVEL: 'info' })

    /**
     * `provision-practice` for a practice, the slug, name or handle overridden where a case says so, the manager's
     * password on standard input; the log at info so a run's lines can be read, or silent when the id alone on stdout
     * is the point.
     */
    const provision = (
      practice: Practice,
      overrides: Partial<Pick<Practice, 'slug' | 'name' | 'managerHandle'>> = {},
      logLevel: 'info' | 'silent' = 'info',
    ) => {
      const input = { ...practice, ...overrides }
      return runCommand(
        'provision-practice',
        [
          '--slug',
          input.slug,
          '--name',
          input.name,
          '--manager-handle',
          input.managerHandle,
          '--manager-name',
          input.managerName,
          '--location-name',
          input.locationName,
        ],
        commandEnv(urls, logLevel),
        `${TEST_PASSWORD}\n`,
      )
    }

    /** A practice's sign in rows (spec #18): its organization, the logins under its code, their memberships. */
    async function signInRowsOf(practice: Practice) {
      return {
        organizations: (
          await migrator.query('select id, slug from control.organization where slug = $1', [practice.slug])
        ).rows,
        logins: (
          await migrator.query(`select id, username from control."user" where username like '%@' || $1`, [
            practice.slug,
          ])
        ).rows,
        members: (
          await migrator.query('select user_id, role from control.member where organization_id = $1', [practice.id])
        ).rows,
      }
    }

    /** One statement through a practice's role as its manager, in a request transaction of its own (asPractice, test-support.ts). */
    const as = (practice: Practice, query: string, values: unknown[] = []) =>
      asPractice(app, practice, (client) => client.query(query, values))

    /**
     * What the commands leave behind, read as the migrator: the registry, each schema's migrations table, and the row
     * count of every registered table per practice; equal before and after a rerun (AC-10).
     */
    async function stateOf() {
      const registered = [alfa, beta, gamma].filter((practice) => practice.id)
      const registry = (await migrator.query('select * from control.practice order by created_at, id')).rows
      const migrations: Record<string, unknown[]> = {}
      for (const schema of ['control', ...registered.map((practice) => practice.schema)]) {
        migrations[schema] = (
          await migrator.query(
            `select id, name, hash, created_at from ${ident(schema)}.${MIGRATIONS_TABLE} order by id`,
          )
        ).rows
      }
      const signIn = (
        await migrator.query(
          `select (select count(*)::int from control.organization) as organizations,
                  (select count(*)::int from control."user") as logins,
                  (select count(*)::int from control.member) as members`,
        )
      ).rows
      const counts: Record<string, Record<string, number>> = {}
      for (const practice of registered) {
        const perTable: Record<string, number> = {}
        for (const table of tableClassRegistry.tables.keys()) {
          const count = await migrator.query<{ count: number }>(
            `select count(*)::int as count from ${ident(practice.schema)}.${ident(table)}`,
          )
          perTable[table] = count.rows[0]?.count ?? Number.NaN
        }
        counts[practice.schema] = perTable
      }
      return { registry, migrations, counts, signIn }
    }

    it('migrate on an empty database applies the control set and finds no practice to migrate: exit 0 (AC-10)', async () => {
      const run = await migrate()

      expect(run.code).toBe(0)
      expect(run.lines.filter((line) => line.msg === 'applied').map((line) => line.migration)).toEqual(controlSet())
      expect(run.lines.at(-1)).toMatchObject({ msg: 'migrate done', applied: controlSet().length, practices: 0 })
      const schemas = await migrator.query<{ nspname: string }>(
        "select nspname from pg_namespace where nspname in ('control', 'ext') or nspname like 'p\\_%' order by 1",
      )
      expect(schemas.rows.map((row) => row.nspname)).toEqual(['control', 'ext'])
      expect((await app.query('select * from control.practice')).rows).toEqual([])
    }, 15_000)

    it('provision-practice alfa, then beta: exit 0, the practice id as the last line of stdout after the log; each is active in the registry behind its own schema and role, with the practice set applied and the three seed rows written as its manager (AC-10)', async () => {
      for (const practice of [alfa, beta]) {
        const run = await provision(practice)

        expect(run.code, practice.slug).toBe(0)
        const printed = run.stdout.trim().split('\n').at(-1) ?? ''
        expect(printed, practice.slug).toMatch(UUID_V7)
        expect(run.lines.at(-1), practice.slug).toMatchObject({
          slug: practice.slug,
          practiceId: printed,
          activated: true,
          msg: 'practice provisioned',
        })
        practice.id = printed
        practice.schema = `p_${practice.id}`
        practice.role = `p_${practice.id}_role`
        const login = await migrator.query<{ id: string }>('select id from control."user" where username = $1', [
          `${practice.managerHandle}@${practice.slug}`,
        ])
        practice.managerId = login.rows[0]?.id ?? ''
        expect(practice.managerId, practice.slug).toMatch(UUID_V7)
        // One organization with the practice's id, one login under its code, one membership as manager (spec #18).
        expect(await signInRowsOf(practice), practice.slug).toEqual({
          organizations: [{ id: practice.id, slug: practice.slug }],
          logins: [{ id: practice.managerId, username: `${practice.managerHandle}@${practice.slug}` }],
          members: [{ user_id: practice.managerId, role: 'manager' }],
        })
      }
      // The registry is readable by vetora_app without a role switch: it routes a request (spec 0002, Security model).
      const registry = await app.query(
        'select id, slug, name, schema_name, role_name, status from control.practice order by created_at, id',
      )
      expect(registry.rows).toEqual([
        {
          id: alfa.id,
          slug: 'alfa',
          name: 'Alfa Vet',
          schema_name: alfa.schema,
          role_name: alfa.role,
          status: 'active',
        },
        {
          id: beta.id,
          slug: 'beta',
          name: 'Beta Vet',
          schema_name: beta.schema,
          role_name: beta.role,
          status: 'active',
        },
      ])
      for (const practice of [alfa, beta]) {
        expect(await recordedMigrations(migrator, practice.schema), practice.slug).toEqual(practiceSet())
        // The seed rows as the manager sees them through the role: one staff member (themselves), the settings, the default location.
        const seeded = await asPractice(app, practice, async (client) => ({
          staff: (await client.query(`select id, display_name, roles from ${ident(practice.schema)}.staff_member`))
            .rows,
          settings: (
            await client.query(
              `select display_name, default_language, created_by from ${ident(practice.schema)}.practice_settings`,
            )
          ).rows,
          locations: (await client.query(`select name, is_default, created_by from ${ident(practice.schema)}.location`))
            .rows,
        }))
        expect(seeded, practice.slug).toEqual({
          staff: [{ id: practice.managerId, display_name: practice.managerName, roles: ['manager'] }],
          settings: [{ display_name: practice.name, default_language: 'az', created_by: practice.managerId }],
          locations: [{ name: practice.locationName, is_default: true, created_by: practice.managerId }],
        })
      }
    }, 20_000)

    it('migrate with both practices registered: exit 0, nothing pending anywhere, the grants pass run in each schema in registry order (AC-10)', async () => {
      const run = await migrate()

      expect(run.code).toBe(0)
      const perSchema = run.lines
        .filter((line) => ['nothing to do', 'grants applied'].includes(String(line.msg)))
        .map((line) => `${line.schema}: ${line.msg}`)
      expect(perSchema).toEqual([
        'control: nothing to do',
        `${alfa.schema}: nothing to do`,
        `${alfa.schema}: grants applied`,
        `${beta.schema}: nothing to do`,
        `${beta.schema}: grants applied`,
      ])
      const granted = run.lines
        .filter((line) => line.msg === 'grants applied')
        .map((line) => Object.keys(line.tables as Record<string, unknown>).sort())
      const practiceTables = [
        'audit_event',
        'breed',
        'care_relationship',
        'client',
        'client_contact',
        'clinical_observation',
        'encounter',
        'location',
        'ownership',
        'patient',
        'practice_settings',
        'species',
        'staff_member',
      ]
      expect(granted).toEqual([practiceTables, practiceTables])
      expect(run.lines.at(-1)).toMatchObject({ msg: 'migrate done', applied: 0, practices: 2 })
    }, 15_000)

    it('a practice registered behind the set, its registry row, role, and empty schema written by hand as a restore would leave them: migrate catches it up in order and runs its grants pass, exit 0 (AC-10)', async () => {
      const inserted = await migrator.query<{ id: string; schema_name: string; role_name: string }>(
        `insert into control.practice (id, slug, name, schema_name, role_name)
         select id, $1, $2, 'p_' || id, 'p_' || id || '_role' from (select uuidv7() as id) as issued
         returning id, schema_name, role_name`,
        [gamma.slug, gamma.name],
      )
      const row = inserted.rows[0]
      if (!row) throw new Error('the registry insert returned no row')
      gamma.id = row.id
      gamma.schema = row.schema_name
      gamma.role = row.role_name
      await migrator.query(`create role ${ident(gamma.role)} nologin`)
      await migrator.query(`create schema ${ident(gamma.schema)} authorization vetora_migrator`)

      const run = await migrate()

      expect(run.code).toBe(0)
      const applied = run.lines
        .filter((line) => line.schema === gamma.schema && line.msg === 'applied')
        .map((line) => line.migration)
      expect(applied).toEqual(practiceSet())
      expect(run.lines.find((line) => line.schema === gamma.schema && line.msg === 'grants applied')).toMatchObject({
        slug: 'gamma',
        role: gamma.role,
      })
      expect(run.lines.at(-1)).toMatchObject({ msg: 'migrate done', applied: 0, practices: 3 })
      expect(await recordedMigrations(migrator, gamma.schema)).toEqual(practiceSet())
      // vetora_app's membership in the role is provisioning's step, so the role is read through the catalog here.
      const privileges = await migrator.query(
        `select has_schema_privilege($1, $2, 'USAGE') as usage, has_table_privilege($1, $3, 'SELECT') as "select",
                has_table_privilege($1, $3, 'DELETE') as "delete"`,
        [gamma.role, gamma.schema, `${ident(gamma.schema)}.practice_settings`],
      )
      expect(privileges.rows).toEqual([{ usage: true, select: true, delete: false }])
    }, 15_000)

    it('isolation: vetora_app reads no practice table without a role switch, and as one practice none of the other, even by its schema qualified name (AC-11)', async () => {
      const locations = (practice: Practice) => `select name from ${ident(practice.schema)}.location`

      await expect(app.query(locations(alfa))).rejects.toMatchObject(PERMISSION_DENIED)
      await expect(app.query(locations(beta))).rejects.toMatchObject(PERMISSION_DENIED)
      expect((await as(alfa, locations(alfa))).rows).toEqual([{ name: 'Nərimanov' }])
      await expect(as(alfa, locations(beta))).rejects.toMatchObject(PERMISSION_DENIED)
      expect((await as(beta, locations(beta))).rows).toEqual([{ name: 'Gənclik' }])
      await expect(as(beta, locations(alfa))).rejects.toMatchObject(PERMISSION_DENIED)
    })

    it('happy path (IN-1): a location inserted with an actor in each practice reads back in its own schema alone, stamped with the actor, and its audit_event row names the actor and the request (AC-8, AC-11)', async () => {
      const inserted = new Map<Practice, string>()
      for (const [practice, name] of [
        [alfa, 'Yasamal'],
        [beta, 'Xətai'],
      ] as const) {
        const row = await asPractice(app, practice, async (client) => {
          await client.query("select set_config('app.request_id', $1, true)", [`rehearsal-${practice.slug}`])
          return (
            await client.query(
              `insert into ${ident(practice.schema)}.location (name) values ($1)
               returning id, created_by, updated_by, version`,
              [name],
            )
          ).rows[0]
        })
        expect(row, practice.slug).toMatchObject({
          created_by: practice.managerId,
          updated_by: practice.managerId,
          version: 1,
        })
        inserted.set(practice, row.id)
      }

      const names = async (practice: Practice) =>
        (await as(practice, `select name from ${ident(practice.schema)}.location order by name`)).rows.map(
          (row) => row.name,
        )
      expect(await names(alfa)).toEqual(['Nərimanov', 'Yasamal'])
      expect(await names(beta)).toEqual(['Gənclik', 'Xətai'])
      for (const practice of [alfa, beta]) {
        const audit = await as(
          practice,
          `select table_name, action, actor_id, source, request_id from ${ident(practice.schema)}.audit_event where row_id = $1`,
          [inserted.get(practice)],
        )
        expect(audit.rows, practice.slug).toEqual([
          {
            table_name: 'location',
            action: 'insert',
            actor_id: practice.managerId,
            source: 'request',
            request_id: `rehearsal-${practice.slug}`,
          },
        ])
      }
    })

    it('permission: a write without an actor fails with vetora.no_actor, DELETE and TRUNCATE are denied on every table of the schema, the migrations table included, and audit_event takes no INSERT or UPDATE from the practice role (AC-8, AC-9, AC-12, IN-1, IN-6)', async () => {
      const noActor = { code: ruleErrors['vetora.no_actor'], message: expect.stringMatching(/^vetora\.no_actor/) }
      for (const actor of [null, '']) {
        await expect(
          asPractice(
            app,
            alfa,
            (client) => client.query(`insert into ${ident(alfa.schema)}.location (name) values ('Nobody')`),
            { actor },
          ),
        ).rejects.toMatchObject(noActor)
      }
      // Every table the schema holds: the registered ones, which the grants pass checked, and Drizzle's own.
      for (const table of [...tableClassRegistry.tables.keys(), MIGRATIONS_TABLE]) {
        await expect(as(alfa, `delete from ${ident(alfa.schema)}.${ident(table)}`), table).rejects.toMatchObject(
          PERMISSION_DENIED,
        )
        await expect(as(beta, `truncate ${ident(beta.schema)}.${ident(table)}`), table).rejects.toMatchObject(
          PERMISSION_DENIED,
        )
      }
      await expect(
        as(
          alfa,
          `insert into ${ident(alfa.schema)}.audit_event (table_name, row_id, action, actor_id, source, changed)
           values ('location', uuidv7(), 'insert', $1, 'request', '{}')`,
          [alfa.managerId],
        ),
      ).rejects.toMatchObject(PERMISSION_DENIED)
      await expect(as(alfa, `update ${ident(alfa.schema)}.audit_event set changed = '{}'`)).rejects.toMatchObject(
        PERMISSION_DENIED,
      )
      // Nothing of it landed.
      const nobody = await as(
        alfa,
        `select count(*)::int as count from ${ident(alfa.schema)}.location where name = 'Nobody'`,
      )
      expect(nobody.rows).toEqual([{ count: 0 }])
    })

    it("checks: default_language = 'tr' fails the lang_code check, and a future occurred_at on the rules fixture fails its check (AC-13)", async () => {
      const checkViolation = { code: '23514' }

      await expect(
        as(alfa, `update ${ident(alfa.schema)}.practice_settings set default_language = 'tr'`),
      ).rejects.toMatchObject({ ...checkViolation, constraint: 'lang_code_check' })
      await expect(
        as(alfa, `update ${ident(alfa.schema)}.practice_settings set languages = '{az,tr}'`),
      ).rejects.toMatchObject(checkViolation)
      // An event table's occurred_at: the fixture stands in for slice 1's tables (spec 0002, Follow-up: the harness).
      const fixture = await createRulesFixture(urls, alfa)
      try {
        await expect(
          as(
            alfa,
            `insert into ${ident(alfa.schema)}.fixture_record (note, occurred_at) values ('ahead', now() + interval '1 hour')`,
          ),
        ).rejects.toMatchObject({ ...checkViolation, constraint: 'fixture_record_occurred_at_check' })
        const behind = await as(
          alfa,
          `insert into ${ident(alfa.schema)}.fixture_record (note, occurred_at) values ('an hour ago', now() - interval '1 hour')`,
        )
        expect(behind.rowCount).toBe(1)
      } finally {
        await fixture.drop()
      }
      const settings = await as(
        alfa,
        `select default_language, languages::text[] as languages from ${ident(alfa.schema)}.practice_settings`,
      )
      expect(settings.rows).toEqual([{ default_language: 'az', languages: ['az', 'ru'] }])
    })

    it('a rerun of provision-practice for each practice and of migrate changes nothing: the registry, every migrations table, and every row count are as before; migrate --dry-run lists nothing (AC-10)', async () => {
      const before = await stateOf()

      for (const practice of [alfa, beta]) {
        // Silent, the scriptable form: the id is all that stdout carries.
        const run = await provision(practice, {}, 'silent')
        expect(run.code, practice.slug).toBe(0)
        expect(run.stdout.trim(), practice.slug).toBe(practice.id)
      }
      const again = await migrate()
      expect(again.code).toBe(0)
      expect(again.lines.filter((line) => line.msg === 'nothing to do').map((line) => line.schema)).toEqual([
        'control',
        alfa.schema,
        beta.schema,
        gamma.schema,
      ])
      expect(await stateOf()).toEqual(before)

      const dryRun = await migrate(['--dry-run'])
      expect(dryRun.code).toBe(0)
      expect(
        dryRun.lines
          .filter((line) => String(line.msg).startsWith('dry run'))
          .map((line) => [line.schema, line.msg, line.pending]),
      ).toEqual([
        ['control', 'dry run: nothing to do', []],
        [alfa.schema, 'dry run: nothing to do', []],
        [beta.schema, 'dry run: nothing to do', []],
        [gamma.schema, 'dry run: nothing to do', []],
      ])
      expect(await stateOf()).toEqual(before)
    }, 30_000)

    it('the exit codes an operator reads: 1 for a slug held under another name, an invalid argument, an unregistered --practice, and a missing DATABASE_URL_MIGRATOR, 2 while another run holds the lock; none of them changes anything (AC-10)', async () => {
      const before = await stateOf()

      const taken = await provision(alfa, { name: 'Someone else' })
      expect(taken.code).toBe(1)
      expect(taken.lines.at(-1)).toMatchObject({
        level: LEVEL.error,
        slug: 'alfa',
        msg: 'the slug belongs to a practice with another name; nothing changed',
      })
      const invalid = await provision(alfa, { slug: 'Alfa Vet' })
      expect(invalid.code).toBe(1)
      expect(invalid.lines.at(-1)).toMatchObject({ level: LEVEL.fatal, invalid: [{ option: '--slug' }] })
      const unregistered = await migrate(['--practice', 'delta'])
      expect(unregistered.code).toBe(1)
      expect(unregistered.lines.at(-1)).toMatchObject({
        level: LEVEL.error,
        slug: 'delta',
        msg: 'practice not registered',
      })
      const unconfigured = await runCommand('migrate', [], { LOG_LEVEL: 'info' })
      expect(unconfigured.code).toBe(1)
      expect(unconfigured.lines.at(-1)).toMatchObject({ level: LEVEL.fatal, variables: ['DATABASE_URL_MIGRATOR'] })

      // The migrate lock is a session lock: held here on the migrator connection, as another run would hold it.
      await migrator.query('select pg_advisory_lock($1)', [MIGRATE_LOCK_KEY])
      try {
        const locked = await migrate()
        expect(locked.code).toBe(2)
        expect(locked.lines.at(-1)).toMatchObject({ level: LEVEL.warn, msg: 'another migrate holds the lock' })
        const lockedProvision = await provision(alfa)
        expect(lockedProvision.code).toBe(2)
        expect(lockedProvision.lines.at(-1)).toMatchObject({ level: LEVEL.warn, slug: 'alfa' })
      } finally {
        await migrator.query('select pg_advisory_unlock($1)', [MIGRATE_LOCK_KEY])
      }
      expect(await stateOf()).toEqual(before)
    }, 40_000)

    it('no run printed a connection string, a name, a handle or a password: a command logs ids, slugs, schema and role names, and counts (spec 0002, Security model: personal data)', () => {
      // Every kind of run is in the sample: the successful ones with their log, the refused ones, the held lock.
      expect(new Set(runs.map((run) => run.code))).toEqual(new Set([0, 1, 2]))
      const printed = runs.map((run) => run.stdout + run.stderr).join('\n')
      expect(printed).not.toContain('vetora_migrator:')
      expect(printed).not.toContain('vetora_app:')
      for (const name of [
        'Alfa Vet',
        'Beta Vet',
        'Gamma Vet',
        'Dr Aliyeva',
        'Dr Bayramova',
        'dr.aliyeva',
        'dr.bayramova',
        TEST_PASSWORD,
        'Nərimanov',
        'Gənclik',
        'Someone else',
      ]) {
        expect(printed, name).not.toContain(name)
      }
      expect(printed).toContain(alfa.id)
      expect(printed).toContain(gamma.schema)
    })
  },
)
