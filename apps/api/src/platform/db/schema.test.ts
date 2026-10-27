import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getTableColumns, getTableName, is } from 'drizzle-orm'
import { numeric, PgTable, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest'
import * as controlSchema from './control-schema.js'
import { type CurrencyCode, type LangCode, minorUnits } from './domains.js'
import { db } from './index.js'
import { migrate } from './migrator.js'
import * as platformTables from './platform-tables.js'
import { location, type practiceSettings } from './platform-tables.js'
import * as practiceSchema from './practice-schema.js'
import { MIGRATIONS_TABLE } from './table-classes.js'
import {
  databaseTestsEnabled,
  provisionTestPractice,
  resetTestDatabase,
  type TestDatabaseUrls,
  type TestPractice,
  testDatabaseUrls,
} from './test-support.js'

/** The thirteen bounded contexts of docs/domain.md §6, as src/modules/README.md lists them. */
const MODULES = [
  'billing',
  'client',
  'client-communication',
  'clinical-record',
  'diagnostics',
  'hospitalization',
  'identity-access',
  'inventory',
  'non-clinical-services',
  'patient',
  'prescription-dispensing',
  'preventive-care',
  'scheduling',
] as const

const MODULES_FOLDER = fileURLToPath(new URL('../../modules', import.meta.url))

/** The tables a schema module exports; its other exports (helpers, constants) are not tables. */
const tablesOf = (schema: Record<string, unknown>): PgTable[] =>
  Object.values(schema).filter((value): value is PgTable => is(value, PgTable))

const tableNames = (schema: Record<string, unknown>): string[] => tablesOf(schema).map(getTableName).sort()

/** The export names of a schema module that are tables: what defineRelations() keeps, and what db().query names. */
type TableKeys<Schema> = { [K in keyof Schema]: Schema[K] extends PgTable ? K : never }[keyof Schema]

/** One column as both the Drizzle declaration and the catalog describe it. */
type ColumnShape = { table: string; column: string; type: string; notNull: boolean }

/**
 * Drizzle's spelling of a type as format_type() prints it: no space after the comma of a typmod (`numeric(10, 3)` is
 * `numeric(10,3)`), the long names for varchar and char. The array dimensions come separately in Drizzle 1.0.
 */
const canonicalType = (type: string): string =>
  type
    .replace(/,\s+/g, ',')
    .replace(/^varchar\b/, 'character varying')
    .replace(/^char\b/, 'character')

const declaredColumns = (tables: readonly PgTable[]): ColumnShape[] =>
  tables.flatMap((table) =>
    Object.values(getTableColumns(table)).map((column) => ({
      table: getTableName(table),
      column: column.name,
      type: `${canonicalType(column.getSQLType())}${'[]'.repeat(column.dimensions)}`,
      notNull: column.notNull,
    })),
  )

/** Every column of every table in a schema as Postgres has it, Drizzle's migrations table left out. */
async function liveColumns(client: pg.Client, schema: string): Promise<ColumnShape[]> {
  const result = await client.query<{ table: string; column: string; type: string; not_null: boolean }>(
    `select c.relname as "table", a.attname as "column",
            replace(format_type(a.atttypid, a.atttypmod), quote_ident(n.nspname) || '.', '') as type,
            a.attnotnull as not_null
     from pg_attribute a
     join pg_class c on c.oid = a.attrelid
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = $1 and c.relkind = 'r' and c.relname <> $2 and a.attnum > 0 and not a.attisdropped
     order by c.relname, a.attnum`,
    [schema, MIGRATIONS_TABLE],
  )
  return result.rows.map((row) => ({ table: row.table, column: row.column, type: row.type, notNull: row.not_null }))
}

/**
 * Where the declarations and the migrated schema disagree (AC-1): a table or a column on one side alone, a type or a
 * nullability that differs. Empty exactly when the committed migrations carry every declared column as declared.
 */
function schemaMismatches(declared: readonly ColumnShape[], live: readonly ColumnShape[]): string[] {
  const problems: string[] = []
  const declaredTables = new Set(declared.map((column) => column.table))
  const liveTables = new Set(live.map((column) => column.table))
  for (const table of declaredTables) {
    if (!liveTables.has(table)) problems.push(`table "${table}" is declared but not in the schema`)
  }
  for (const table of liveTables) {
    if (!declaredTables.has(table)) problems.push(`table "${table}" is in the schema but not declared`)
  }
  const key = (column: ColumnShape) => `${column.table}.${column.column}`
  const liveByKey = new Map(live.map((column) => [key(column), column]))
  const declaredKeys = new Set(declared.map(key))
  const nullability = (notNull: boolean) => (notNull ? 'not null' : 'nullable')
  for (const column of declared) {
    if (!liveTables.has(column.table)) continue
    const actual = liveByKey.get(key(column))
    if (!actual) {
      problems.push(`column "${key(column)}" is declared but not in the schema`)
      continue
    }
    if (actual.type !== column.type) {
      problems.push(`column "${key(column)}" is declared as ${column.type} but the schema has ${actual.type}`)
    }
    if (actual.notNull !== column.notNull) {
      problems.push(
        `column "${key(column)}" is declared ${nullability(column.notNull)} but the schema has it ${nullability(actual.notNull)}`,
      )
    }
  }
  for (const column of live) {
    if (declaredTables.has(column.table) && !declaredKeys.has(key(column))) {
      problems.push(`column "${key(column)}" is in the schema but not declared`)
    }
  }
  return problems
}

describe('the module schema skeleton (AC-1; spec 0002, Interface surface: Drizzle schema modules)', () => {
  it('has a folder per bounded context, each with its schema.ts and its index.ts, the public interface', () => {
    const folders = readdirSync(MODULES_FOLDER, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    expect(folders).toEqual([...MODULES])
    for (const module of MODULES) {
      expect(existsSync(join(MODULES_FOLDER, module, 'schema.ts')), `${module}/schema.ts`).toBe(true)
      expect(existsSync(join(MODULES_FOLDER, module, 'index.ts')), `${module}/index.ts`).toBe(true)
    }
  })

  it('practice-schema.ts gathers every platform table and every module schema; control-schema.ts holds the registry and the sign in tables', () => {
    const source = readFileSync(new URL('./practice-schema.ts', import.meta.url), 'utf8')
    for (const module of MODULES) {
      expect(source, module).toContain(`export * from '../../modules/${module}/schema.js'`)
    }
    expect(tableNames(practiceSchema)).toEqual(expect.arrayContaining(tableNames(platformTables)))
    // The registry, the models Better Auth's configured plugins declare (spec #18; no two factor table, ADR 0008), and
    // the sign in lock (#20).
    expect(tableNames(controlSchema)).toEqual([
      'account',
      'invitation',
      'member',
      'organization',
      'practice',
      'rate_limit',
      'session',
      'sign_in_lock',
      'user',
      'verification',
    ])
  })
})

describe('the domain types and the typed db() (AC-1; IN-4, AC-13)', () => {
  it('pins lang_code to the three codes, currency_code to AZN, and minor_units to bigint', () => {
    type Settings = typeof practiceSettings.$inferSelect
    expectTypeOf<Settings['languages']>().toEqualTypeOf<LangCode[]>()
    expectTypeOf<Settings['defaultLanguage']>().toEqualTypeOf<'az' | 'ru' | 'en'>()
    expectTypeOf<Settings['currency']>().toEqualTypeOf<CurrencyCode>()
    expectTypeOf<Settings['currency']>().toEqualTypeOf<'AZN'>()
    // No table carries money yet (product and invoice_line arrive with their slices): a probe table pins the type.
    const money = pgTable('money_probe', { amount: minorUnits('amount').notNull() })
    expectTypeOf<(typeof money.$inferSelect)['amount']>().toEqualTypeOf<bigint>()
    expectTypeOf<(typeof money.$inferInsert)['amount']>().toEqualTypeOf<bigint>()
  })

  it('db().query names exactly the tables of both schemas, and select().from(location) keeps the columns as declared', () => {
    type Database = ReturnType<typeof db>
    // Every table export of both schema modules and nothing else; an untyped instance (every key a string) fails here.
    expectTypeOf<keyof Database['query']>().toEqualTypeOf<
      TableKeys<typeof controlSchema> | TableKeys<typeof practiceSchema>
    >()
    // The registry from the control schema and a platform table from the practice schema are both among them.
    expectTypeOf<'practice' | 'location'>().toMatchTypeOf<keyof Database['query']>()
    // Declared and never run: the rows a select returns are the table's row type (the domain types included).
    const selectLocations = () => db().select().from(location)
    expectTypeOf<Awaited<ReturnType<typeof selectLocations>>[number]>().toEqualTypeOf<typeof location.$inferSelect>()
    // The two schemas merge into one relational config by export name, so no name may be exported by both.
    expectTypeOf<keyof typeof controlSchema & keyof typeof practiceSchema>().toEqualTypeOf<never>()
  })
})

describe.skipIf(!databaseTestsEnabled())('the Drizzle declarations match the migrated schemas (AC-1)', () => {
  let urls: TestDatabaseUrls
  let migrator: pg.Client
  let practice: TestPractice

  beforeAll(async () => {
    urls = testDatabaseUrls()
    await resetTestDatabase(urls)
    await migrate({ url: urls.migrator })
    migrator = new pg.Client({ connectionString: urls.migrator, application_name: 'schema.test' })
    await migrator.connect()
    practice = await provisionTestPractice(urls)
  })

  afterAll(async () => {
    await practice?.drop()
    await migrator?.end()
  })

  it('control: the tables are exactly those of control-schema.ts, every column with its type and nullability', async () => {
    const live = await liveColumns(migrator, 'control')

    expect([...new Set(live.map((column) => column.table))]).toEqual(tableNames(controlSchema))
    expect(schemaMismatches(declaredColumns(tablesOf(controlSchema)), live)).toEqual([])
  })

  it('a provisioned practice: the tables are exactly those practice-schema.ts declares, every column with its type and nullability, the domains by name', async () => {
    const live = await liveColumns(migrator, practice.schema)

    expect([...new Set(live.map((column) => column.table))].sort()).toEqual(tableNames(practiceSchema))
    expect(schemaMismatches(declaredColumns(tablesOf(practiceSchema)), live)).toEqual([])
    // The domains come through under their own names, so a column typed text by mistake would be caught.
    const settings = live.filter((column) => column.table === 'practice_settings')
    expect(settings.filter((column) => column.type.startsWith('currency_code')).map((column) => column.column)).toEqual(
      ['currency'],
    )
    expect(settings.filter((column) => column.type.startsWith('lang_code')).map((column) => column.type)).toEqual([
      'lang_code[]',
      'lang_code',
    ])
  })

  it("reads numeric(p, s) and varchar(n) as Postgres prints them, so the sketch's numeric(10,3) columns will compare equal", async () => {
    const probe = pgTable('parity_probe', {
      weight: numeric('weight', { precision: 10, scale: 3 }).notNull(),
      code: varchar('code', { length: 32 }),
      note: text('note'),
    })
    await migrator.query('create temp table parity_probe (weight numeric(10,3) not null, code varchar(32), note text)')
    try {
      const temp = await migrator.query<{ nspname: string }>(
        'select nspname from pg_namespace where oid = pg_my_temp_schema()',
      )
      const live = await liveColumns(migrator, temp.rows[0]?.nspname ?? '')
      expect(live.map((column) => column.type)).toEqual(['numeric(10,3)', 'character varying(32)', 'text'])
      expect(schemaMismatches(declaredColumns([probe]), live)).toEqual([])
    } finally {
      await migrator.query('drop table parity_probe')
    }
  })

  it('fails when a Drizzle table gains a column without a migration, and names a type or nullability that differs and a table on one side alone', async () => {
    const live = await liveColumns(migrator, practice.schema)
    const declared = declaredColumns(tablesOf(practiceSchema))

    // location as a slice might redeclare it with one more column and no migration.
    const grown = pgTable('location', { id: uuid('id').primaryKey(), extra: text('extra') })
    expect(schemaMismatches(declaredColumns([grown]), live)).toContain(
      'column "location.extra" is declared but not in the schema',
    )

    const tampered = declared.map((column) =>
      column.table === 'location' && column.column === 'name' ? { ...column, type: 'integer', notNull: false } : column,
    )
    tampered.push({ table: 'ghost', column: 'id', type: 'uuid', notNull: true })
    expect(schemaMismatches(tampered, live)).toEqual([
      'table "ghost" is declared but not in the schema',
      'column "location.name" is declared as integer but the schema has text',
      'column "location.name" is declared nullable but the schema has it not null',
    ])
    expect(
      schemaMismatches(
        declared.filter((column) => column.table !== 'audit_event'),
        live,
      ),
    ).toEqual(['table "audit_event" is in the schema but not declared'])
    expect(
      schemaMismatches(
        declared.filter((column) => column.column !== 'version'),
        live,
      ),
    ).toEqual([
      'column "location.version" is in the schema but not declared',
      'column "practice_settings.version" is in the schema but not declared',
      'column "staff_member.version" is in the schema but not declared',
    ])
  })
})
