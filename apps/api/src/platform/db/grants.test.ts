import { rmSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyGrants, TableClassMismatch } from './grants.js'
import { migrate, PRACTICE_MIGRATIONS_FOLDER } from './migrator.js'
import { type TableClassRegistry, type TableEntry, tableClassRegistry } from './table-classes.js'
import {
  asPractice,
  captureLog,
  databaseTestsEnabled,
  PERMISSION_DENIED,
  practiceSet,
  provisionTestPractice,
  recordedMigrations,
  resetTestDatabase,
  type TestDatabaseUrls,
  type TestPractice,
  tableExists,
  testDatabaseUrls,
  withExtraMigration,
} from './test-support.js'

const TABLE_PRIVILEGES = ['INSERT', 'SELECT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] as const

/**
 * What spec 0002 ("Conventions": Table classes) lets each class do, stated here apart from grants.ts: the table level
 * privileges, and the columns an UPDATE may touch (every column where the class grants UPDATE on the table).
 */
function expectedGrant(entry: TableEntry, columns: string[]): { table: string[]; updatable: string[] } {
  switch (entry.class) {
    case 'append_only':
      return { table: ['INSERT', 'SELECT'], updatable: [] }
    case 'set_once':
      return {
        table: ['INSERT', 'SELECT'],
        updatable: columns.filter((column) => [...entry.setOnce, ...(entry.movesLater ?? [])].includes(column)),
      }
    case 'mutable':
    case 'frozen_by_status': {
      const noUpdate = entry.noUpdate ?? []
      return noUpdate.length
        ? { table: ['INSERT', 'SELECT'], updatable: columns.filter((column) => !noUpdate.includes(column)) }
        : { table: ['INSERT', 'SELECT', 'UPDATE'], updatable: columns }
    }
    case 'function_written':
      return { table: ['SELECT'], updatable: [] }
  }
}

describe.skipIf(!databaseTestsEnabled())(
  'the grants pass gives the practice role exactly its table class (AC-9, AC-11, AC-12)',
  () => {
    let urls: TestDatabaseUrls
    let migrator: pg.Client
    /** vetora_app on vetora_test: what a request sees. */
    let app: pg.Client
    /** One throwaway practice for the file: the scratch cases roll back, the refused migrations too, the rest only read. */
    let practice: TestPractice
    let schema: string

    beforeAll(async () => {
      urls = testDatabaseUrls()
      await resetTestDatabase(urls)
      await migrate({ url: urls.migrator })
      migrator = new pg.Client({ connectionString: urls.migrator, application_name: 'grants.test' })
      await migrator.connect()
      app = new pg.Client({ connectionString: urls.app, application_name: 'grants.test app' })
      await app.connect()
      practice = await provisionTestPractice(urls)
      schema = pg.escapeIdentifier(practice.schema)
    })

    afterAll(async () => {
      await practice?.drop()
      await migrator.end()
      await app.end()
    })

    const qualified = (table: string) => `${schema}.${pg.escapeIdentifier(table)}`

    /** The table level privileges a role holds on a table, as has_table_privilege answers, in a fixed order. */
    async function tablePrivileges(table: string, role = practice.role): Promise<string[]> {
      const held: string[] = []
      for (const privilege of TABLE_PRIVILEGES) {
        const result = await migrator.query<{ held: boolean }>('select has_table_privilege($1, $2, $3) as held', [
          role,
          qualified(table),
          privilege,
        ])
        if (result.rows[0]?.held) held.push(privilege)
      }
      return held
    }

    /** A table's columns in order. */
    async function columnsOf(table: string): Promise<string[]> {
      const result = await migrator.query<{ column: string }>(
        `select a.attname as column from pg_attribute a
         where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum`,
        [qualified(table)],
      )
      return result.rows.map((row) => row.column)
    }

    /** Which of a table's columns the practice role may UPDATE, column by column (has_column_privilege). */
    async function updatableColumns(table: string): Promise<string[]> {
      const result = await migrator.query<{ column: string }>(
        `select a.attname as column from pg_attribute a
         where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped
           and has_column_privilege($2, a.attrelid, a.attnum, 'UPDATE')
         order by a.attnum`,
        [qualified(table), practice.role],
      )
      return result.rows.map((row) => row.column)
    }

    /** The functions of the practice schema PUBLIC may execute: a new function's default ACL grants it until the pass revokes it. */
    async function publicExecutable(): Promise<string[]> {
      const result = await migrator.query<{ name: string }>(
        `select distinct p.proname as name from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace,
         aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
         where n.nspname = $1 and acl.grantee = 0 and acl.privilege_type = 'EXECUTE' order by p.proname`,
        [practice.schema],
      )
      return result.rows.map((row) => row.name)
    }

    /**
     * Run `body` as the migrator inside one transaction on the practice schema that is always rolled back, so the
     * scratch objects it creates and the grants the pass sets on them never outlive the case (the ticket's seam).
     */
    async function inScratchTransaction<T>(body: () => Promise<T>): Promise<T> {
      await migrator.query('begin')
      try {
        await migrator.query(`set local search_path to ${schema}, ext`)
        return await body()
      } finally {
        await migrator.query('rollback')
      }
    }

    /** A scratch practice table with the standard columns and, unless told otherwise, the two shared triggers. */
    async function createScratchTable(name: string, { triggers = true } = {}): Promise<void> {
      const table = pg.escapeIdentifier(name)
      await migrator.query(
        `create table ${table} (
           id uuid primary key default uuidv7(), status text, note text, withdrawn_at timestamptz, quantity_on_hand bigint,
           created_at timestamptz not null default now(), created_by uuid,
           updated_at timestamptz not null default now(), updated_by uuid, version integer not null default 1)`,
      )
      if (!triggers) return
      await migrator.query(
        `create trigger set_updated_at before insert or update on ${table} for each row execute function set_updated_at()`,
      )
      await migrator.query(
        `create trigger audit_row after insert or update or delete on ${table} for each row execute function audit_row()`,
      )
    }

    /** The committed registry plus the entries a case adds. */
    const withEntries = (entries: [string, TableEntry][]): TableClassRegistry => ({
      ...tableClassRegistry,
      tables: new Map([...tableClassRegistry.tables, ...entries]),
    })

    it('a scratch table of each class gets exactly the class privileges: set_once and noUpdate column by column, DELETE on none (AC-9, IN-6)', async () => {
      await inScratchTransaction(async () => {
        for (const name of ['append_only', 'set_once', 'mutable', 'frozen_by_status', 'function_written']) {
          await createScratchTable(`scratch_${name}`)
        }
        const scratch = withEntries([
          ['scratch_append_only', { class: 'append_only' }],
          ['scratch_set_once', { class: 'set_once', setOnce: ['withdrawn_at'] }],
          ['scratch_mutable', { class: 'mutable', noUpdate: ['quantity_on_hand'] }],
          ['scratch_frozen_by_status', { class: 'frozen_by_status' }],
          ['scratch_function_written', { class: 'function_written' }],
        ])

        const granted = await applyGrants(migrator, practice, scratch)

        expect(await tablePrivileges('scratch_append_only')).toEqual(['INSERT', 'SELECT'])
        expect(await updatableColumns('scratch_append_only')).toEqual([])
        // Set once: no table level UPDATE, a column level grant on the named columns only (spec 0002, Table classes).
        expect(await tablePrivileges('scratch_set_once')).toEqual(['INSERT', 'SELECT'])
        expect(await updatableColumns('scratch_set_once')).toEqual(['withdrawn_at'])
        // A noUpdate exception, the shape lot.quantity_on_hand takes: UPDATE on every other column.
        expect(await tablePrivileges('scratch_mutable')).toEqual(['INSERT', 'SELECT'])
        expect(await updatableColumns('scratch_mutable')).toEqual([
          'id',
          'status',
          'note',
          'withdrawn_at',
          'created_at',
          'created_by',
          'updated_at',
          'updated_by',
          'version',
        ])
        expect(await tablePrivileges('scratch_frozen_by_status')).toEqual(['INSERT', 'SELECT', 'UPDATE'])
        expect(await tablePrivileges('scratch_function_written')).toEqual(['SELECT'])
        expect(await updatableColumns('scratch_function_written')).toEqual([])
        // The platform tables keep their classes alongside.
        expect(await tablePrivileges('location')).toEqual(['INSERT', 'SELECT', 'UPDATE'])
        expect(await tablePrivileges('audit_event')).toEqual(['SELECT'])
        // What the pass reports for the command's log: every table with its class and the privileges granted.
        expect(granted.tables).toMatchObject({
          scratch_set_once: { class: 'set_once', privileges: ['INSERT', 'SELECT', 'UPDATE (withdrawn_at)'] },
          scratch_function_written: { class: 'function_written', privileges: ['SELECT'] },
          audit_event: { class: 'function_written', privileges: ['SELECT'] },
        })
      })
    })

    it('a registered view is readable and a registered function callable, every overload; an unregistered function is not, and PUBLIC can call nothing in the schema (AC-11)', async () => {
      await inScratchTransaction(async () => {
        await migrator.query('create view scratch_view as select count(*) as locations from location')
        await migrator.query(
          'create function scratch_fn(n integer) returns integer language sql immutable return n + 1',
        )
        await migrator.query('create function scratch_fn(s text) returns text language sql immutable return s')
        // Fresh functions are executable by PUBLIC until the pass runs.
        expect(await publicExecutable()).toEqual(['scratch_fn'])
        const scratch: TableClassRegistry = {
          ...tableClassRegistry,
          views: new Set(['scratch_view']),
          functions: new Set(['scratch_fn']),
        }

        const granted = await applyGrants(migrator, practice, scratch)

        expect(await tablePrivileges('scratch_view')).toEqual(['SELECT'])
        const callable = await migrator.query(
          `select has_function_privilege($1, '${schema}.scratch_fn(integer)', 'EXECUTE') as "integer",
                  has_function_privilege($1, '${schema}.scratch_fn(text)', 'EXECUTE') as text,
                  has_function_privilege($1, '${schema}.current_actor()', 'EXECUTE') as current_actor`,
          [practice.role],
        )
        expect(callable.rows[0]).toEqual({ integer: true, text: true, current_actor: false })
        expect(await publicExecutable()).toEqual([])
        expect(granted).toMatchObject({ views: ['scratch_view'], functions: ['scratch_fn'] })
      })
    })

    it('a grant a migration gave PUBLIC or vetora_app on the schema or a table goes with the pass, so the practice role never widens past its class and vetora_app keeps nothing of its own (AC-9, AC-11)', async () => {
      await inScratchTransaction(async () => {
        await migrator.query(`grant usage on schema ${schema} to public, vetora_app`)
        await migrator.query(`grant delete, truncate on ${schema}.location to public`)
        await migrator.query(`grant select, update on ${schema}.location to vetora_app`)
        // PUBLIC's grants reach every role, the practice role included.
        expect(await tablePrivileges('location')).toEqual(['INSERT', 'SELECT', 'UPDATE', 'DELETE', 'TRUNCATE'])

        await applyGrants(migrator, practice)

        expect(await tablePrivileges('location')).toEqual(['INSERT', 'SELECT', 'UPDATE'])
        expect(await tablePrivileges('location', 'vetora_app')).toEqual([])
        const usage = await migrator.query(
          `select has_schema_privilege('vetora_app', $1, 'USAGE') as app,
                  exists (select 1 from pg_namespace n, aclexplode(n.nspacl) as acl
                          where n.nspname = $1 and acl.grantee = 0) as public`,
          [practice.schema],
        )
        expect(usage.rows).toEqual([{ app: false, public: false }])
      })
    })

    describe('refuses a schema that disagrees with the registry, every problem named, before it grants anything (AC-8, AC-9)', () => {
      /** The error the pass rejects with, or undefined when it passed. */
      const refusal = (scratch: TableClassRegistry) =>
        applyGrants(migrator, practice, scratch).then(
          () => undefined,
          (error: unknown) => error,
        )

      it('a table with no class, a view with no entry', async () => {
        await inScratchTransaction(async () => {
          await createScratchTable('stray')
          await migrator.query('create view scratch_view as select 1 as one')

          const error = await refusal(tableClassRegistry)

          expect(error).toBeInstanceOf(TableClassMismatch)
          expect(error).toMatchObject({
            problems: [
              'table "stray" has no class in table-classes.ts',
              'view "scratch_view" is not registered in table-classes.ts',
            ],
          })
        })
      })

      it('a registry entry with no table, view, or function behind it, and a table registered as a view', async () => {
        await inScratchTransaction(async () => {
          await migrator.query('create view scratch_view as select 1 as one')
          const scratch: TableClassRegistry = {
            tables: new Map([
              ...tableClassRegistry.tables,
              ['ghost', { class: 'mutable' }],
              ['scratch_view', { class: 'mutable' }],
            ]),
            views: new Set(['ghost_view']),
            functions: new Set(['ghost_fn']),
          }

          expect(await refusal(scratch)).toMatchObject({
            problems: [
              'table "ghost" is registered but not in the schema',
              'table "scratch_view" is registered but "scratch_view" is a view',
              'view "ghost_view" is registered but not in the schema',
              'function "ghost_fn" is registered but not in the schema',
            ],
          })
        })
      })

      it('a table without the two shared triggers, audit_event alone excepted (IN-1, AC-8; spec 0002, Audit is mandatory)', async () => {
        await inScratchTransaction(async () => {
          await createScratchTable('bare', { triggers: false })
          await createScratchTable('half', { triggers: false })
          await migrator.query(
            'create trigger set_updated_at before insert or update on half for each row execute function set_updated_at()',
          )
          const scratch = withEntries([
            ['bare', { class: 'append_only' }],
            ['half', { class: 'mutable' }],
          ])

          expect(await refusal(scratch)).toMatchObject({
            problems: [
              'table "bare" has no set_updated_at trigger',
              'table "bare" has no audit_row trigger',
              'table "half" has no audit_row trigger',
            ],
          })
        })
      })

      it('a shared trigger that is disabled, runs another function, or fires on other events: the name alone is not the trigger (IN-1, AC-8)', async () => {
        await inScratchTransaction(async () => {
          await createScratchTable('disabled')
          await migrator.query('alter table disabled disable trigger audit_row')
          await createScratchTable('impostor')
          await migrator.query(
            'create function scratch_noop() returns trigger language plpgsql as $$ begin return null; end $$',
          )
          await migrator.query('drop trigger audit_row on impostor')
          await migrator.query(
            'create trigger audit_row after insert or update or delete on impostor for each row execute function scratch_noop()',
          )
          await createScratchTable('partial')
          await migrator.query('drop trigger audit_row on partial')
          await migrator.query(
            'create trigger audit_row after insert on partial for each row execute function audit_row()',
          )
          await migrator.query('drop trigger set_updated_at on partial')
          await migrator.query(
            'create trigger set_updated_at before insert or update on partial for each statement execute function set_updated_at()',
          )
          const scratch = withEntries([
            ['disabled', { class: 'mutable' }],
            ['impostor', { class: 'mutable' }],
            ['partial', { class: 'mutable' }],
          ])

          expect(await refusal(scratch)).toMatchObject({
            problems: [
              'table "disabled" has its audit_row trigger disabled',
              'table "impostor" has its audit_row trigger running scratch_noop() instead of audit_row()',
              'table "partial" has its set_updated_at trigger not firing BEFORE INSERT OR UPDATE FOR EACH ROW',
              'table "partial" has its audit_row trigger not firing AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW',
            ],
          })
        })
      })

      it('a column an entry names that the table does not have', async () => {
        await inScratchTransaction(async () => {
          await createScratchTable('scratch_set_once')
          await createScratchTable('scratch_mutable')
          const scratch = withEntries([
            ['scratch_set_once', { class: 'set_once', setOnce: ['withdrawn_at', 'nope'] }],
            ['scratch_mutable', { class: 'mutable', noUpdate: ['quantity_on_hand', 'gone'] }],
          ])

          expect(await refusal(scratch)).toMatchObject({
            problems: [
              'column "nope" of table "scratch_set_once" is named in table-classes.ts but not in the schema',
              'column "gone" of table "scratch_mutable" is named in table-classes.ts but not in the schema',
            ],
          })
        })
      })

      it('grants nothing when it refuses: a privilege revoked by hand before the pass stays revoked', async () => {
        await inScratchTransaction(async () => {
          await migrator.query(`revoke select on ${schema}.location from ${pg.escapeIdentifier(practice.role)}`)
          await createScratchTable('stray')

          const error = await refusal(tableClassRegistry)

          expect(error).toMatchObject({ message: expect.stringContaining('table "stray" has no class') })
          expect(await tablePrivileges('location')).toEqual(['INSERT', 'UPDATE'])
          expect(await tablePrivileges('stray')).toEqual([])
        })
      })
    })

    describe("under migrate, inside the schema's transaction (AC-8, AC-9, AC-10)", () => {
      /** `migrate` with the committed practice set plus one more migration, which is removed afterwards. */
      async function migrateWithExtra(name: string, sql: string, log?: ReturnType<typeof captureLog>['log']) {
        const folder = withExtraMigration(PRACTICE_MIGRATIONS_FOLDER, name, sql)
        try {
          return await migrate({ url: urls.migrator, practiceFolder: folder, log })
        } finally {
          rmSync(folder, { recursive: true, force: true })
        }
      }

      it('a migration that adds a table with no registry entry fails the schema with the table named and rolls the batch back with it: no table, no recorded migration, the grants as before', async () => {
        const stray = '20991231235959_stray'
        const { log, lines } = captureLog()

        const outcome = await migrateWithExtra(
          stray,
          [
            'CREATE TABLE "stray" ("id" uuid PRIMARY KEY DEFAULT uuidv7());',
            'CREATE TRIGGER "set_updated_at" BEFORE INSERT OR UPDATE ON "stray" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"();',
            'CREATE TRIGGER "audit_row" AFTER INSERT OR UPDATE OR DELETE ON "stray" FOR EACH ROW EXECUTE FUNCTION "audit_row"();',
          ].join('\n--> statement-breakpoint\n'),
          log,
        )

        expect(outcome).toEqual({
          status: 'failed',
          schema: practice.schema,
          step: 'grants',
          pending: [stray],
          error: expect.any(TableClassMismatch),
        })
        expect(await tableExists(migrator, practice.schema, 'stray')).toBe(false)
        expect(await recordedMigrations(migrator, practice.schema)).toEqual(practiceSet())
        // The command's log names the table and what is missing (exit code 1 follows from status failed, migrate.ts).
        expect(lines.find((line) => line.msg === 'grants pass refused the schema, batch rolled back')).toMatchObject({
          schema: practice.schema,
          slug: practice.slug,
          pending: [stray],
          err: { problems: ['table "stray" has no class in table-classes.ts'] },
        })
        expect(await tablePrivileges('location')).toEqual(['INSERT', 'SELECT', 'UPDATE'])
      })

      it("a migration that drops a table's audit trigger is refused the same way, and the trigger is still there (IN-1, AC-8)", async () => {
        const outcome = await migrateWithExtra('20991231235959_unaudited', 'DROP TRIGGER "audit_row" ON "location";\n')

        expect(outcome).toMatchObject({
          status: 'failed',
          step: 'grants',
          error: { problems: ['table "location" has no audit_row trigger'] },
        })
        const triggers = await migrator.query<{ tgname: string }>(
          `select tgname from pg_trigger where tgrelid = '${schema}.location'::regclass and not tgisinternal order by tgname`,
        )
        expect(triggers.rows.map((row) => row.tgname)).toEqual(['audit_row', 'set_updated_at'])
        expect(await recordedMigrations(migrator, practice.schema)).toEqual(practiceSet())
      })

      it('a migration that drops a registered table is refused too, and the table is still there with its rows (AC-9)', async () => {
        const before = await migrator.query(`select count(*)::int as count from ${schema}.location`)

        // CASCADE, since visits reference the location (#22): the drop goes through and the pass refuses it all the same.
        const outcome = await migrateWithExtra('20991231235959_dropped', 'DROP TABLE "location" CASCADE;\n')

        expect(outcome).toMatchObject({
          status: 'failed',
          step: 'grants',
          error: { problems: ['table "location" is registered but not in the schema'] },
        })
        expect(await tableExists(migrator, practice.schema, 'location')).toBe(true)
        expect((await migrator.query(`select count(*)::int as count from ${schema}.location`)).rows).toEqual(
          before.rows,
        )
        expect(await recordedMigrations(migrator, practice.schema)).toEqual(practiceSet())
      })

      it('a run with nothing pending still runs the pass and logs, per practice, every table with its class and privileges', async () => {
        const { log, lines } = captureLog()

        const outcome = await migrate({ url: urls.migrator, log })

        expect(outcome).toMatchObject({ status: 'applied', practices: [{ schema: practice.schema, applied: [] }] })
        expect(lines.find((line) => line.msg === 'grants applied')).toMatchObject({
          schema: practice.schema,
          slug: practice.slug,
          role: practice.role,
          tables: {
            practice_settings: { class: 'mutable', privileges: ['INSERT', 'SELECT', 'UPDATE'] },
            location: { class: 'mutable', privileges: ['INSERT', 'SELECT', 'UPDATE'] },
            staff_member: { class: 'mutable', privileges: ['INSERT', 'SELECT', 'UPDATE'] },
            audit_event: { class: 'function_written', privileges: ['SELECT'] },
          },
          views: [],
          functions: [],
        })
      })
    })

    describe('on a provisioned practice (AC-9, AC-11, AC-12)', () => {
      it("the practice role's privileges on every table equal its class, table level and column level, DELETE on none, nothing on the migrations table (AC-9, IN-6)", async () => {
        const tables = await migrator.query<{ name: string }>(
          'select tablename as name from pg_tables where schemaname = $1 order by tablename',
          [practice.schema],
        )
        // Every table of the schema is registered: the pass would have refused the schema otherwise.
        expect(tables.rows.map((row) => row.name)).toEqual([
          '__drizzle_migrations',
          ...[...tableClassRegistry.tables.keys()].sort(),
        ])
        for (const [table, entry] of tableClassRegistry.tables) {
          const expected = expectedGrant(entry, await columnsOf(table))
          expect(await tablePrivileges(table), table).toEqual(expected.table)
          expect(await updatableColumns(table), table).toEqual(expected.updatable)
        }
        expect(await tablePrivileges('__drizzle_migrations')).toEqual([])
      })

      it('vetora_backup reads every table in control and in the practice schema; vetora_app holds no grant of its own on the schema or any table in it; PUBLIC executes no function (AC-11)', async () => {
        const unreadable = await migrator.query<{ table: string }>(
          `select format('%I.%I', schemaname, tablename) as table from pg_tables
           where schemaname in ('control', $1)
             and not has_table_privilege('vetora_backup', format('%I.%I', schemaname, tablename), 'SELECT')
           order by 1`,
          [practice.schema],
        )
        expect(unreadable.rows).toEqual([])
        const held = await migrator.query<{ table: string }>(
          `select format('%I.%I', schemaname, tablename) as table from pg_tables
           where schemaname = $1 and has_table_privilege('vetora_app', format('%I.%I', schemaname, tablename),
             'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')`,
          [practice.schema],
        )
        expect(held.rows).toEqual([])
        const usage = await migrator.query("select has_schema_privilege('vetora_app', $1, 'USAGE') as usage", [
          practice.schema,
        ])
        expect(usage.rows).toEqual([{ usage: false }])
        expect(await publicExecutable()).toEqual([])
      })

      it('a second pass changes nothing: every relation and routine keeps its ACL (idempotent)', async () => {
        // Each ACL as a sorted set: a pass revokes and grants again, which moves the role's item to the end of the array.
        const acls = async () =>
          (
            await migrator.query(
              `select c.relname as name,
                      (select array_agg(item::text order by item::text) from unnest(c.relacl) as item) as acl
               from pg_class c
               join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relkind in ('r', 'v', 'S')
               union all
               select p.proname, (select array_agg(item::text order by item::text) from unnest(p.proacl) as item)
               from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = $1
               order by 1, 2`,
              [practice.schema],
            )
          ).rows
        const before = await acls()
        expect(before.length).toBeGreaterThan(0)

        await migrator.query('begin')
        await applyGrants(migrator, practice)
        await migrator.query('commit')

        expect(await acls()).toEqual(before)
      })

      it('through the practice role: DELETE and TRUNCATE are permission denied on every table, INSERT and UPDATE on audit_event too, the migrations table is unreadable, while a mutable table takes INSERT, SELECT, and UPDATE (AC-9, AC-12, IN-6)', async () => {
        const as = (query: string) => asPractice(app, practice, (client) => client.query(query))

        for (const table of tableClassRegistry.tables.keys()) {
          await expect(as(`delete from ${qualified(table)}`), table).rejects.toMatchObject(PERMISSION_DENIED)
          await expect(as(`truncate ${qualified(table)}`), table).rejects.toMatchObject(PERMISSION_DENIED)
        }
        await expect(
          as(
            `insert into ${schema}.audit_event (table_name, row_id, action, source, changed)
             values ('location', uuidv7(), 'insert', 'request', '{}')`,
          ),
        ).rejects.toMatchObject(PERMISSION_DENIED)
        await expect(as(`update ${schema}.audit_event set changed = '{}'`)).rejects.toMatchObject(PERMISSION_DENIED)
        await expect(as(`select * from ${schema}.__drizzle_migrations`)).rejects.toMatchObject(PERMISSION_DENIED)
        // TEMP is revoked from the app role at database level (infra/postgres/init/01-vetora.sql), so no temporary table shadows a practice table.
        await expect(app.query('create temp table shadow (id int)')).rejects.toMatchObject(PERMISSION_DENIED)

        const written = await as(`insert into ${schema}.location (name) values ('Granted') returning id`)
        expect(written.rowCount).toBe(1)
        const updated = await as(`update ${schema}.location set active = false where name = 'Granted' returning active`)
        expect(updated.rows).toEqual([{ active: false }])
        const read = await as(`select count(*)::int as count from ${schema}.audit_event`)
        expect(read.rows[0]?.count).toBeGreaterThan(0)
      })
    })
  },
)
