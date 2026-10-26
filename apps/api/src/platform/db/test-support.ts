import { randomUUID } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import pg from 'pg'
import { type Logger, pino } from 'pino'
import { applyGrants } from './grants.js'
import { CONTROL_MIGRATIONS_FOLDER, PRACTICE_MIGRATIONS_FOLDER } from './migrator.js'
import { type ProvisionInput, provisionPractice } from './provisioning.js'
import { MIGRATIONS_TABLE, type TableClassRegistry, type TableEntry, tableClassRegistry } from './table-classes.js'
import { dropRole, type TestDatabaseUrls } from './test-database.js'

/**
 * The helpers the database tests share (spec 0002, "Critical test scenarios"): the migration sets as folders, a
 * throwaway practice, a request transaction as its role, a log capture, two catalog reads, the rules fixture a
 * trigger or constraint is proven with, and a connected client for a test outside src/platform. The test database itself (its URLs, the reset, the Vitest globalSetup) is
 * test-database.ts, re-exported here so a test imports one module. Kept out of dist/ by tsconfig.build.json.
 */
export {
  databaseTestsEnabled,
  resetTestDatabase,
  TEST_DATABASE,
  type TestDatabaseUrls,
  testDatabaseUrls,
} from './test-database.js'

/**
 * A pg.Client as the tests type it: a test outside src/platform may not import pg itself (biome.jsonc,
 * noRestrictedImports), so this alias, `escapeIdentifier`, and `connectTestClient()` stand in for it there.
 */
export type TestClient = pg.Client

/** pg's identifier quoting, for the same tests: a practice schema or role name carries its UUID with hyphens. */
export const escapeIdentifier: (name: string) => string = pg.escapeIdentifier

/** A connected client on one of the test database's URLs, named in pg_stat_activity; the caller ends it. */
export async function connectTestClient(url: string, applicationName: string): Promise<TestClient> {
  const client = new pg.Client({ connectionString: url, application_name: applicationName })
  await client.connect()
  return client
}

/** What a statement a role may not run fails with: SQLSTATE 42501, insufficient_privilege. */
export const PERMISSION_DENIED = { code: '42501' } as const

/** A UUID v7 as Postgres 18's uuidv7() issues it: the practice ids and every row id (spec 0002, "Conventions": Keys). */
export const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The two sets as drizzle-kit lays them out: one folder per migration, applied in name order (spec 0001, "Migrations"). */
export const controlSet = (): string[] => readdirSync(CONTROL_MIGRATIONS_FOLDER).sort()
export const practiceSet = (): string[] => readdirSync(PRACTICE_MIGRATIONS_FOLDER).sort()

/** A copy of a migration set in a temporary folder with one more migration at the end; the caller removes the folder. */
export function withExtraMigration(source: string, name: string, sql: string): string {
  const folder = mkdtempSync(join(tmpdir(), 'vetora-migrations-'))
  cpSync(source, folder, { recursive: true })
  mkdirSync(join(folder, name))
  writeFileSync(join(folder, name, 'migration.sql'), sql)
  return folder
}

/** The migration names recorded in <schema>.__drizzle_migrations, in apply order. */
export async function recordedMigrations(client: pg.Client, schema: string): Promise<string[]> {
  const rows = await client.query<{ name: string }>(
    `select name from ${pg.escapeIdentifier(schema)}.${MIGRATIONS_TABLE} order by id`,
  )
  return rows.rows.map((row) => row.name)
}

/** Whether <schema>.<table> exists. */
export async function tableExists(client: pg.Client, schema: string, table: string): Promise<boolean> {
  const found = await client.query<{ found: string | null }>('select to_regclass($1) as found', [
    `${pg.escapeIdentifier(schema)}.${pg.escapeIdentifier(table)}`,
  ])
  return found.rows[0]?.found != null
}

/** The password every test login is given: ten characters or more, as a login's must be. */
export const TEST_PASSWORD = 'correct horse battery staple'

/** A throwaway practice for a test: provisioned as the command would, dropped by `drop()` as the migrator. */
export type TestPractice = {
  practiceId: string
  /** The practice code its staff sign in with. */
  slug: string
  schema: string
  role: string
  /** The first manager's login id, which is also their staff_member id: the actor a test's request transactions set (IN-1). */
  managerId: string
  /** The manager's handle; they sign in as `<managerHandle>@<slug>` with TEST_PASSWORD. */
  managerHandle: string
  drop: () => Promise<void>
}

type TestPracticeOptions = Partial<ProvisionInput> & { log?: Logger }

/**
 * Provision a practice with a unique slug (or the one given) through provisionPractice(), the same path the command
 * takes, its manager's login and organization included, and hand back what a test needs to address it; a test drops
 * it afterwards with `drop()`.
 */
export async function provisionTestPractice(
  urls: TestDatabaseUrls,
  options: TestPracticeOptions = {},
): Promise<TestPractice> {
  const slug = options.slug ?? `t-${randomUUID().slice(0, 8)}`
  const input: ProvisionInput = {
    slug,
    name: options.name ?? `Practice ${slug}`,
    managerHandle: options.managerHandle ?? 'manager',
    managerName: options.managerName ?? 'Dr Test',
    locationName: options.locationName ?? 'Main',
    timeZone: options.timeZone ?? 'Asia/Baku',
    languages: options.languages ?? ['az', 'ru'],
  }
  const outcome = await provisionPractice({
    url: urls.migrator,
    input,
    managerPassword: async () => TEST_PASSWORD,
    log: options.log,
  })
  if (outcome.status !== 'provisioned') throw new Error(`test practice ${slug} was not provisioned: ${outcome.status}`)
  const practice = { practiceId: outcome.practiceId, slug, schema: outcome.schema, role: outcome.role }
  return {
    ...practice,
    managerId: outcome.managerId,
    managerHandle: input.managerHandle,
    drop: () => dropTestPractice(urls, practice),
  }
}

export type RequestOptions = {
  /** app.actor_id for the transaction: the practice's manager unless given; null leaves it unset and '' sets it empty, both refused by IN-1. */
  actor?: string | null
}

/**
 * Open a request transaction as the request context of slice 1 will (spec 0002, "Roles"): on a vetora_app connection,
 * BEGIN, SET LOCAL ROLE to the practice role, and app.actor_id for the transaction. asPractice() runs one to its end; a
 * concurrency case holds one open by hand while another connection works, and commits or rolls it back itself.
 */
export async function beginAsPractice(
  app: pg.Client,
  practice: Pick<TestPractice, 'role' | 'managerId'>,
  { actor = practice.managerId }: RequestOptions = {},
): Promise<void> {
  await app.query('begin')
  try {
    await app.query(`set local role ${pg.escapeIdentifier(practice.role)}`)
    if (actor !== null) await app.query("select set_config('app.actor_id', $1, true)", [actor])
  } catch (error) {
    await app.query('rollback')
    throw error
  }
}

/**
 * One request transaction (beginAsPractice()) around `run`: committed when `run` returns, rolled back when it throws,
 * so a refused write leaves nothing and the connection is clean for the next case.
 */
export async function asPractice<T>(
  app: pg.Client,
  practice: Pick<TestPractice, 'role' | 'managerId'>,
  run: (client: pg.Client) => Promise<T>,
  options?: RequestOptions,
): Promise<T> {
  await beginAsPractice(app, practice, options)
  try {
    const result = await run(app)
    await app.query('commit')
    return result
  } catch (error) {
    await app.query('rollback')
    throw error
  }
}

/**
 * Remove a test practice as the migrator: its schema (cascade), what its role holds and the role, its logins (every
 * `…@<code>` username, their sessions, credentials and memberships with them) and its organization, then its registry
 * row, which the organization's foreign key holds until then.
 */
export async function dropTestPractice(
  urls: TestDatabaseUrls,
  { practiceId, schema, role }: Pick<TestPractice, 'practiceId' | 'schema' | 'role'>,
): Promise<void> {
  await asMigrator(urls, 'vetora-test-practice', async (client) => {
    await client.query(`drop schema if exists ${pg.escapeIdentifier(schema)} cascade`)
    await dropRole(client, role)
    await client.query(
      `delete from control."user"
       where username like '%@' || (select slug from control.practice where id = $1)`,
      [practiceId],
    )
    await client.query('delete from control.organization where id = $1', [practiceId])
    await client.query('delete from control.practice where id = $1', [practiceId])
  })
}

/** A pino logger whose JSON lines land in an array, so a test can read what a command logged. */
export function captureLog(): { log: Logger; lines: Array<Record<string, unknown>> } {
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

/**
 * The rules fixture (spec 0002, "Critical test scenarios": Checks; "Follow-up": the test harness for trigger and
 * constraint behaviour): the harness every slice proves its triggers with. Its tables live in a throwaway practice's
 * schema, created as the migrator the way a migration creates a table (search_path set to the schema, the two shared
 * triggers, the rule triggers with their arguments) and granted by class through the grants pass with these entries
 * added to the registry; committed, so the vetora_app connections of a test see them (uncommitted DDL would be
 * invisible to them), and removed by `drop()`, which leaves the schema as provisioning left it (audit_event keeps the
 * rows the fixture wrote, as for any table). fixture_record is frozen by status (CR-1, freeze_record), an event with
 * occurred_at (AC-13), and needs a fixture_companion row by commit when it says so (RX-3's shape, the deferred check
 * convention: assert_fixture_companion); fixture_child is frozen with its parent (CR-1, lock_parent);
 * fixture_companion is a set once row (AC-9, set_once).
 */
const RULES_FIXTURE_TABLES: readonly (readonly [string, TableEntry])[] = [
  ['fixture_record', { class: 'frozen_by_status' }],
  ['fixture_child', { class: 'frozen_by_status' }],
  ['fixture_companion', { class: 'set_once', setOnce: ['acknowledged_at'] }],
]

/** The fixture as a migration would write it; unqualified names land in the schema search_path points at. */
const RULES_FIXTURE_SQL = `
create table fixture_record (
  id uuid primary key default uuidv7(),
  status text not null default 'draft'
    constraint fixture_record_status_check check (status in ('draft', 'finalised', 'discarded')),
  note text,
  closing_note text,
  needs_companion boolean not null default false,
  occurred_at timestamptz not null default now()
    constraint fixture_record_occurred_at_check check (occurred_at <= now()),
  created_at timestamptz not null default now(),
  created_by uuid references staff_member (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references staff_member (id),
  version integer not null default 1
);
create trigger set_updated_at before insert or update on fixture_record
  for each row execute function set_updated_at();
create trigger audit_row after insert or update or delete on fixture_record
  for each row execute function audit_row();
create trigger freeze_record before update or delete on fixture_record
  for each row execute function freeze_record('status', 'finalised, discarded', 'closing_note');
create trigger assert_backdate_limit before insert or update on fixture_record
  for each row execute function assert_backdate_limit();

create table fixture_child (
  id uuid primary key default uuidv7(),
  fixture_record_id uuid not null references fixture_record (id),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references staff_member (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references staff_member (id),
  version integer not null default 1
);
create index fixture_child_record_idx on fixture_child (fixture_record_id);
create trigger set_updated_at before insert or update on fixture_child
  for each row execute function set_updated_at();
create trigger audit_row after insert or update or delete on fixture_child
  for each row execute function audit_row();
create trigger lock_parent before insert or update or delete on fixture_child
  for each row execute function lock_parent('fixture_record', 'fixture_record_id', 'status', 'finalised, discarded');

create table fixture_companion (
  id uuid primary key default uuidv7(),
  fixture_record_id uuid not null unique references fixture_record (id),
  note text,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references staff_member (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references staff_member (id),
  version integer not null default 1
);
create trigger set_updated_at before insert or update on fixture_companion
  for each row execute function set_updated_at();
create trigger audit_row after insert or update or delete on fixture_companion
  for each row execute function audit_row();
create trigger set_once before update on fixture_companion
  for each row execute function set_once('acknowledged_at');

-- The deferred check convention (RX-3, IN-3; spec 0002, "Who writes"): one function per rule, written by the slice
-- that owns the rule, run by a DEFERRABLE INITIALLY DEFERRED constraint trigger AFTER INSERT OR UPDATE when the
-- transaction commits; it raises vetora.incomplete_<rule>: <missing row> with INCOMPLETE_RULE_CODE (errors.ts), and
-- the whole transaction rolls back. A deferred trigger is handed the row as the event wrote it, so the function reads
-- the row by id as it stands at commit (nothing, when it is gone), or an insert followed by an update would be checked
-- on the stale version. Here: a fixture_record that needs a companion has its fixture_companion row by commit.
create function assert_fixture_companion() returns trigger
  language plpgsql security definer
  set search_path = pg_catalog
as $$
declare
  needed boolean;
  present boolean;
begin
  execute format(
    'select r.needs_companion, exists (select 1 from %1$I.fixture_companion c where c.fixture_record_id = r.id)
     from %1$I.fixture_record r where r.id = $1',
    TG_TABLE_SCHEMA
  ) into needed, present using NEW.id;
  if needed and not present then
    raise exception using message = 'vetora.incomplete_fixture_companion: fixture_companion', errcode = 'VT005';
  end if;
  return null;
end
$$;
revoke all on function assert_fixture_companion() from public;
create constraint trigger assert_fixture_companion after insert or update on fixture_record
  deferrable initially deferred for each row execute function assert_fixture_companion();
`

export type RulesFixture = {
  /** Drop the fixture tables and the companion check as the migrator; the schema is then as provisioning left it. */
  drop: () => Promise<void>
}

/** Create the rules fixture in a test practice's schema, as the migrator, granted by class; `drop()` removes it. */
export async function createRulesFixture(
  urls: TestDatabaseUrls,
  practice: Pick<TestPractice, 'schema' | 'role'>,
): Promise<RulesFixture> {
  const registry: TableClassRegistry = {
    ...tableClassRegistry,
    tables: new Map([...tableClassRegistry.tables, ...RULES_FIXTURE_TABLES]),
  }
  await asMigrator(urls, 'vetora-test-rules-fixture', async (client) => {
    await client.query('begin')
    try {
      await client.query(`set local search_path to ${pg.escapeIdentifier(practice.schema)}, ext`)
      await client.query(RULES_FIXTURE_SQL)
      await applyGrants(client, practice, registry)
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  })
  return { drop: () => dropRulesFixture(urls, practice.schema) }
}

async function dropRulesFixture(urls: TestDatabaseUrls, schema: string): Promise<void> {
  const qualified = (name: string) => `${pg.escapeIdentifier(schema)}.${pg.escapeIdentifier(name)}`
  await asMigrator(urls, 'vetora-test-rules-fixture', async (client) => {
    await client.query(
      `drop table if exists ${qualified('fixture_child')}, ${qualified('fixture_companion')}, ${qualified('fixture_record')} cascade`,
    )
    await client.query(`drop function if exists ${qualified('assert_fixture_companion')}()`)
  })
}

/** One migrator connection on vetora_test for `run`, closed afterwards. */
async function asMigrator<T>(
  urls: TestDatabaseUrls,
  applicationName: string,
  run: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = await connectTestClient(urls.migrator, applicationName)
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}
