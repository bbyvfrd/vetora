import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { INCOMPLETE_RULE_CODE, missingRowOf, ruleErrors, ruleOf } from './errors.js'
import { migrate } from './migrator.js'
import {
  asPractice,
  beginAsPractice,
  createRulesFixture,
  databaseTestsEnabled,
  PERMISSION_DENIED,
  provisionTestPractice,
  type RequestOptions,
  type RulesFixture,
  resetTestDatabase,
  type TestDatabaseUrls,
  type TestPractice,
  testDatabaseUrls,
} from './test-support.js'

describe.skipIf(!databaseTestsEnabled())('the rules the database refuses to bend (spec 0002, Key invariants)', () => {
  let urls: TestDatabaseUrls
  let migrator: pg.Client
  /** vetora_app on vetora_test: what a request sees. */
  let app: pg.Client
  /** A second vetora_app connection: the other side of the concurrency cases. */
  let app2: pg.Client
  /** One throwaway practice for the file; the fixture tables live in its schema. */
  let practice: TestPractice
  let schema: string
  let fixture: RulesFixture

  beforeAll(async () => {
    urls = testDatabaseUrls()
    await resetTestDatabase(urls)
    await migrate({ url: urls.migrator })
    migrator = new pg.Client({ connectionString: urls.migrator, application_name: 'rules.test' })
    await migrator.connect()
    // What this file writes by hand as the migrator is attributed to it (IN-1).
    await migrator.query("select set_config('app.migration', 'rules.test', false)")
    app = new pg.Client({ connectionString: urls.app, application_name: 'rules.test app' })
    await app.connect()
    app2 = new pg.Client({ connectionString: urls.app, application_name: 'rules.test app 2' })
    await app2.connect()
    practice = await provisionTestPractice(urls)
    schema = pg.escapeIdentifier(practice.schema)
    fixture = await createRulesFixture(urls, practice)
  })

  afterAll(async () => {
    await fixture?.drop()
    await practice?.drop()
    await migrator.end()
    await app.end()
    await app2.end()
  })

  const qualified = (table: string) => `${schema}.${pg.escapeIdentifier(table)}`

  /** One statement through the practice role, in a request transaction of its own. */
  const as = (query: string, values: unknown[] = [], options?: RequestOptions) =>
    asPractice(app, practice, (client) => client.query(query, values), options)

  /** The error a statement fails with, or undefined when it passed. */
  const failure = (statement: Promise<unknown>) =>
    statement.then(
      () => undefined,
      (error: unknown) => error,
    )

  /** What a statement refused by `rule` fails with: the rule's code, and a message that starts with its name. */
  const refusal = (rule: keyof typeof ruleErrors) => ({
    code: ruleErrors[rule],
    message: expect.stringMatching(`^${rule.replaceAll('.', '\\.')}`),
  })

  /** A draft fixture_record inserted through the practice role: its id. */
  async function insertRecord(note = 'draft'): Promise<string> {
    const inserted = await as(`insert into ${qualified('fixture_record')} (note) values ($1) returning id`, [note])
    return inserted.rows[0].id
  }

  /** A fixture_child of `parent` inserted through the practice role: its id. */
  async function insertChild(parent: string, note: string): Promise<string> {
    const inserted = await as(
      `insert into ${qualified('fixture_child')} (fixture_record_id, note) values ($1, $2) returning id`,
      [parent, note],
    )
    return inserted.rows[0].id
  }

  /** The session's backend pid, for pg_blocking_pids(). */
  const pidOf = async (client: pg.Client) =>
    (await client.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]?.pid as number

  /** Wait until the session `pid` is blocked on a lock another session holds (five seconds at most). */
  async function untilBlocked(pid: number): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt++) {
      const result = await migrator.query<{ blocked: boolean }>(
        'select cardinality(pg_blocking_pids($1)) > 0 as blocked',
        [pid],
      )
      if (result.rows[0]?.blocked) return
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error(`session ${pid} never blocked on a lock`)
  }

  /** Every relation and routine of a schema with its ACL (as a sorted set: a pass reorders the items) and its triggers: what the fixture must leave as it found. */
  async function schemaObjects(name: string): Promise<Record<string, unknown>[]> {
    const result = await migrator.query(
      `select c.relname as name, c.relkind::text as kind,
              (select array_agg(item::text order by item::text) from unnest(c.relacl) as item) as acl,
              coalesce((select array_agg(t.tgname::text order by t.tgname) from pg_trigger t
                        where t.tgrelid = c.oid and not t.tgisinternal), '{}'::text[]) as triggers
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = $1 and c.relkind in ('r', 'v', 'S', 'i')
       union all
       select p.proname, 'f', (select array_agg(item::text order by item::text) from unnest(p.proacl) as item), '{}'
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = $1
       order by 1, 2`,
      [name],
    )
    return result.rows
  }

  describe('the harness (spec 0002, Follow-up: the test harness for trigger and constraint behaviour)', () => {
    it('creates the fixture tables with the shared triggers, the rule triggers, and the practice role granted by class, and drops them leaving the practice schema as it was', async () => {
      const other = await provisionTestPractice(urls)
      try {
        const before = await schemaObjects(other.schema)

        const theirs = await createRulesFixture(urls, other)
        const during = await schemaObjects(other.schema)
        expect(during.find((object) => object.name === 'fixture_record')).toMatchObject({
          kind: 'r',
          triggers: [
            'assert_backdate_limit',
            'assert_fixture_companion',
            'audit_row',
            'freeze_record',
            'set_updated_at',
          ],
        })
        expect(during.find((object) => object.name === 'fixture_child')).toMatchObject({
          kind: 'r',
          triggers: ['audit_row', 'lock_parent', 'set_updated_at'],
        })
        expect(during.find((object) => object.name === 'fixture_companion')).toMatchObject({
          kind: 'r',
          triggers: ['audit_row', 'set_once', 'set_updated_at'],
        })
        expect(during.find((object) => object.name === 'assert_fixture_companion')).toMatchObject({ kind: 'f' })
        const privileges = await migrator.query<{ insert: boolean; update: boolean; delete: boolean }>(
          `select has_table_privilege($1, $2, 'INSERT') as insert, has_table_privilege($1, $2, 'UPDATE') as update,
                  has_table_privilege($1, $2, 'DELETE') as delete`,
          [other.role, `${pg.escapeIdentifier(other.schema)}.fixture_record`],
        )
        expect(privileges.rows).toEqual([{ insert: true, update: true, delete: false }])

        await theirs.drop()
        expect(await schemaObjects(other.schema)).toEqual(before)
      } finally {
        await other.drop()
      }
    })

    it('the rule functions run as their owner: the practice role can execute none of them, and PUBLIC cannot either (spec 0002, Security model: Owner run functions)', async () => {
      const functions = [
        'set_once',
        'freeze_record',
        'lock_parent',
        'assert_backdate_limit',
        'assert_fixture_companion',
      ]
      const callable = await migrator.query<{ name: string; role: boolean; public: boolean }>(
        `select f.name, has_function_privilege($1, format('%I.%I()', $2::text, f.name), 'EXECUTE') as role,
                has_function_privilege('vetora_app', format('%I.%I()', $2::text, f.name), 'EXECUTE') as public
         from unnest($3::text[]) as f(name)`,
        [practice.role, practice.schema, functions],
      )
      expect(callable.rows).toEqual(functions.map((name) => ({ name, role: false, public: false })))
      await expect(as(`select ${qualified('freeze_record')}()`)).rejects.toMatchObject(PERMISSION_DENIED)
    })
  })

  describe('the rule codes the schema raises are the ones errors.ts lists (spec 0002, Interface surface; CODING_STANDARDS: guards compare definitions)', () => {
    /** Every `vetora.<rule>` and `VT` code pair a RAISE EXCEPTION in `body` carries, in the SQL's own spelling. */
    function raisedIn(body: string): [string, string][] {
      const pairs: [string, string][] = []
      for (const match of body.matchAll(
        /message = (?:format\()?'(vetora\.[a-z_]+)[^']*'[^;]*?errcode = '(VT\d{3})'/gi,
      )) {
        pairs.push([match[1] as string, match[2] as string])
      }
      return pairs
    }

    it("every pair raised by a function of the practice schema, the fixture's deferred check included, is in ruleErrors or on the family code, and every listed code is raised somewhere", async () => {
      const functions = await migrator.query<{ name: string; body: string }>(
        `select p.proname as name, p.prosrc as body from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace where n.nspname = $1 order by p.proname`,
        [practice.schema],
      )
      const raised = new Map(functions.rows.flatMap(({ body }) => raisedIn(body)))

      // The pairs as the migrations and the fixture spell them today, so the extraction is known to see each one.
      expect(raised).toEqual(
        new Map([
          ['vetora.no_actor', 'VT001'],
          ['vetora.set_once', 'VT002'],
          ['vetora.frozen_record', 'VT003'],
          ['vetora.backdated_too_far', 'VT004'],
          ['vetora.incomplete_allocation', 'VT005'],
          ['vetora.incomplete_fixture_companion', 'VT005'],
          ['vetora.incomplete_invoice', 'VT005'],
          ['vetora.incomplete_payment', 'VT005'],
          ['vetora.not_veterinarian', 'VT006'],
          ['vetora.no_care_relationship', 'VT007'],
          ['vetora.reason_for_visit_required', 'VT008'],
          ['vetora.reporter_required', 'VT009'],
        ]),
      )
      // The guard: the SQL and errors.ts agree pair by pair, in both directions.
      for (const [rule, code] of raised) {
        const expected = rule.startsWith('vetora.incomplete_')
          ? INCOMPLETE_RULE_CODE
          : ruleErrors[rule as keyof typeof ruleErrors]
        expect(code, rule).toBe(expected)
      }
      const listed = [...Object.values(ruleErrors), INCOMPLETE_RULE_CODE].sort()
      expect([...new Set(raised.values())].sort()).toEqual(listed)
    })
  })

  describe('AC-9 set once: a named column goes from null to a value once (spec 0002, Key invariants: Set once columns)', () => {
    const setOnce = refusal('vetora.set_once')

    it('practice_settings.go_live_at takes a value once; a second change, or a reset to null, fails with vetora.set_once, while the rest of the row stays editable (a set once column on a mutable table)', async () => {
      const goLive = new Date('2026-10-20T06:00:00Z')

      const live = await as(`update ${schema}.practice_settings set go_live_at = $1 returning go_live_at`, [goLive])
      expect(live.rows).toEqual([{ go_live_at: goLive }])

      const moved = await failure(
        as(`update ${schema}.practice_settings set go_live_at = $1`, [new Date('2026-11-01T06:00:00Z')]),
      )
      expect(moved).toMatchObject(setOnce)
      // The code alone maps the failure to its rule, as a handler will (errors.ts).
      expect(ruleOf(moved)).toBe('vetora.set_once')
      expect(await failure(as(`update ${schema}.practice_settings set go_live_at = null`))).toMatchObject(setOnce)
      // A column left as it is passes, and the mutable class still edits the rest of the row.
      const renamed = await as(
        `update ${schema}.practice_settings set display_name = 'Renamed', go_live_at = go_live_at
         returning display_name, go_live_at, version`,
      )
      expect(renamed.rows).toEqual([{ display_name: 'Renamed', go_live_at: goLive, version: 3 }])
    })

    it('fixture_companion, a set once class row: acknowledged_at takes a value once; any other column is permission denied to the practice role (the grants) and refused with vetora.set_once for the owner (the trigger), so the class holds for every role', async () => {
      const companion = qualified('fixture_companion')
      const acknowledged = new Date('2026-10-21T08:30:00Z')
      const parent = await insertRecord('with a companion')
      const inserted = await as(
        `insert into ${companion} (fixture_record_id, note) values ($1, 'first') returning id`,
        [parent],
      )
      const id = inserted.rows[0].id

      const once = await as(
        `update ${companion} set acknowledged_at = $2 where id = $1 returning acknowledged_at, version`,
        [id, acknowledged],
      )
      expect(once.rows).toEqual([{ acknowledged_at: acknowledged, version: 2 }])
      expect(
        await failure(as(`update ${companion} set acknowledged_at = $2 where id = $1`, [id, new Date()])),
      ).toMatchObject(setOnce)
      expect(await failure(as(`update ${companion} set acknowledged_at = null where id = $1`, [id]))).toMatchObject(
        setOnce,
      )
      // The practice role holds UPDATE on the named column alone (AC-9, the grants pass): the rest is denied before any trigger.
      expect(await failure(as(`update ${companion} set note = 'changed' where id = $1`, [id]))).toMatchObject(
        PERMISSION_DENIED,
      )
      // The owner, whose grants are not narrowed, meets the trigger: beyond its set once column the row is append only.
      const owner = await failure(migrator.query(`update ${companion} set note = 'changed' where id = $1`, [id]))
      expect(owner).toMatchObject(setOnce)
      expect(ruleOf(owner)).toBe('vetora.set_once')
      const row = await as(`select note, acknowledged_at, version from ${companion} where id = $1`, [id])
      expect(row.rows).toEqual([{ note: 'first', acknowledged_at: acknowledged, version: 2 }])
    })
  })

  describe('CR-1 a frozen record: freeze_record (spec 0002, Key invariants: frozen records; Conventions: frozen by status)', () => {
    const frozen = refusal('vetora.frozen_record')

    it('a draft changes freely; once finalised the row refuses every change but the column its trigger allows, and refuses DELETE, with vetora.frozen_record', async () => {
      const record = qualified('fixture_record')
      const id = await insertRecord()
      await as(`update ${record} set note = 'edited' where id = $1`, [id])

      const finalised = await as(`update ${record} set status = 'finalised' where id = $1 returning status, version`, [
        id,
      ])
      expect(finalised.rows).toEqual([{ status: 'finalised', version: 3 }])

      const refused = await failure(as(`update ${record} set note = 'after' where id = $1`, [id]))
      expect(refused).toMatchObject(frozen)
      expect(ruleOf(refused)).toBe('vetora.frozen_record')
      expect(await failure(as(`update ${record} set status = 'draft' where id = $1`, [id]))).toMatchObject(frozen)
      expect(await failure(as(`update ${record} set status = 'discarded' where id = $1`, [id]))).toMatchObject(frozen)
      expect(await failure(as(`update ${record} set occurred_at = now() where id = $1`, [id]))).toMatchObject(frozen)
      // The allowed column still changes, and the stamp moves with it.
      const closed = await as(
        `update ${record} set closing_note = 'closed' where id = $1 returning closing_note, version`,
        [id],
      )
      expect(closed.rows).toEqual([{ closing_note: 'closed', version: 4 }])
      // The practice role has no DELETE anywhere (IN-6, the grants); the owner meets the rule itself.
      expect(await failure(as(`delete from ${record} where id = $1`, [id]))).toMatchObject(PERMISSION_DENIED)
      expect(await failure(migrator.query(`delete from ${record} where id = $1`, [id]))).toMatchObject(frozen)
      const row = await as(`select note, status, closing_note from ${record} where id = $1`, [id])
      expect(row.rows).toEqual([{ note: 'edited', status: 'finalised', closing_note: 'closed' }])
    })

    it('discarded is a final value too (the trigger takes a list), and a draft is deletable by the owner', async () => {
      const record = qualified('fixture_record')
      const discarded = await insertRecord('to discard')
      await as(`update ${record} set status = 'discarded' where id = $1`, [discarded])
      expect(await failure(as(`update ${record} set note = 'after' where id = $1`, [discarded]))).toMatchObject(frozen)
      expect(await failure(migrator.query(`delete from ${record} where id = $1`, [discarded]))).toMatchObject(frozen)

      const draft = await insertRecord('draft to delete')
      const deleted = await migrator.query(`delete from ${record} where id = $1`, [draft])
      expect(deleted.rowCount).toBe(1)
    })

    it('a trigger argument naming a column the table lacks fails the first write loudly, so a misspelt allowed column never guards nothing', async () => {
      await migrator.query('begin')
      try {
        await migrator.query(`set local search_path to ${schema}, ext`)
        await migrator.query(
          "create table scratch_frozen (id uuid primary key default uuidv7(), status text not null default 'draft', note text)",
        )
        await migrator.query(
          `create trigger freeze_record before update or delete on scratch_frozen
           for each row execute function freeze_record('status', 'finalised', 'closing_nope')`,
        )
        await migrator.query('insert into scratch_frozen default values')
        expect(await failure(migrator.query("update scratch_frozen set note = 'x'"))).toMatchObject({
          message: expect.stringContaining('allows a column the table does not have: closing_nope'),
        })
      } finally {
        await migrator.query('rollback')
      }
    })
  })

  describe('CR-1 the rows of a frozen record: lock_parent (spec 0002, Conventions: a child row insert locks its parent)', () => {
    const frozen = refusal('vetora.frozen_record')

    it('under a draft parent a child is inserted, changed, and deleted; under a finalised parent each is refused with vetora.frozen_record, moving a child under one included', async () => {
      const child = qualified('fixture_child')
      const parent = await insertRecord('parent')
      const first = await insertChild(parent, 'first')
      await as(`update ${child} set note = 'edited' where id = $1`, [first])
      const second = await insertChild(parent, 'second')
      expect((await migrator.query(`delete from ${child} where id = $1`, [second])).rowCount).toBe(1)
      await as(`update ${qualified('fixture_record')} set status = 'finalised' where id = $1`, [parent])

      const refused = await failure(insertChild(parent, 'late'))
      expect(refused).toMatchObject(frozen)
      expect(ruleOf(refused)).toBe('vetora.frozen_record')
      expect(await failure(as(`update ${child} set note = 'after' where id = $1`, [first]))).toMatchObject(frozen)
      expect(await failure(migrator.query(`delete from ${child} where id = $1`, [first]))).toMatchObject(frozen)
      // A child cannot move under the finalised parent, nor away from it: both parents of a move are checked.
      const otherParent = await insertRecord('another draft')
      const movable = await insertChild(otherParent, 'movable')
      expect(
        await failure(as(`update ${child} set fixture_record_id = $1 where id = $2`, [parent, movable])),
      ).toMatchObject(frozen)
      expect(
        await failure(as(`update ${child} set fixture_record_id = $1 where id = $2`, [otherParent, first])),
      ).toMatchObject(frozen)
      const rows = await as(`select note from ${child} where fixture_record_id = $1 order by note`, [parent])
      expect(rows.rows).toEqual([{ note: 'edited' }])
    })

    it('a child insert during a freeze waits for the freeze and is then refused: no child slips in beside a concurrent freeze', async () => {
      const parent = await insertRecord('racing')
      const waiter = await pidOf(app2)
      await beginAsPractice(app, practice)
      try {
        await app.query(`update ${qualified('fixture_record')} set status = 'finalised' where id = $1`, [parent])
        // The other connection's insert blocks on the parent row the freeze holds.
        const inserting = failure(
          asPractice(app2, practice, (client) =>
            client.query(`insert into ${qualified('fixture_child')} (fixture_record_id, note) values ($1, 'during')`, [
              parent,
            ]),
          ),
        )
        await untilBlocked(waiter)
        await app.query('commit')
        expect(await inserting).toMatchObject(frozen)
      } catch (error) {
        await app.query('rollback')
        throw error
      }
      const children = await as(
        `select count(*)::int as count from ${qualified('fixture_child')} where fixture_record_id = $1`,
        [parent],
      )
      expect(children.rows).toEqual([{ count: 0 }])
    }, 15_000)

    it('a freeze during a child insert waits for the insert: the two serialise in the order they began', async () => {
      const parent = await insertRecord('racing back')
      const waiter = await pidOf(app)
      await beginAsPractice(app2, practice)
      try {
        await app2.query(`insert into ${qualified('fixture_child')} (fixture_record_id, note) values ($1, 'before')`, [
          parent,
        ])
        const freezing = asPractice(app, practice, (client) =>
          client.query(
            `update ${qualified('fixture_record')} set status = 'finalised' where id = $1 returning status`,
            [parent],
          ),
        )
        await untilBlocked(waiter)
        await app2.query('commit')
        expect((await freezing).rows).toEqual([{ status: 'finalised' }])
      } catch (error) {
        await app2.query('rollback')
        throw error
      }
      const children = await as(`select note from ${qualified('fixture_child')} where fixture_record_id = $1`, [parent])
      expect(children.rows).toEqual([{ note: 'before' }])
    }, 15_000)
  })

  describe('RX-3, IN-3 companion rows or no commit: the deferred check convention (spec 0002, Who writes; Interface surface: assert_*)', () => {
    it('a transaction that inserts a fixture_record needing a companion and commits without it fails at COMMIT with vetora.incomplete_fixture_companion naming the missing row, and leaves nothing; with the companion row it commits', async () => {
      const record = qualified('fixture_record')
      const companion = qualified('fixture_companion')

      const alone = await failure(as(`insert into ${record} (note, needs_companion) values ('alone', true)`))
      expect(alone).toMatchObject({
        code: INCOMPLETE_RULE_CODE,
        message: 'vetora.incomplete_fixture_companion: fixture_companion',
      })
      // A handler maps the failed commit by the code and reads the rule and the missing row from the message (errors.ts).
      expect(ruleOf(alone)).toBe('vetora.incomplete_fixture_companion')
      expect(missingRowOf(alone)).toBe('fixture_companion')
      expect((await as(`select count(*)::int as count from ${record} where note = 'alone'`)).rows).toEqual([
        { count: 0 },
      ])

      const together = await asPractice(app, practice, async (client) => {
        const inserted = await client.query(
          `insert into ${record} (note, needs_companion) values ('together', true) returning id`,
        )
        // The insert itself passes: the check waits for the commit, so the companion may follow in any order.
        await client.query(`insert into ${companion} (fixture_record_id) values ($1)`, [inserted.rows[0].id])
        return inserted.rows[0].id as string
      })
      const kept = await as(
        `select r.note, c.fixture_record_id is not null as has_companion
         from ${record} r left join ${companion} c on c.fixture_record_id = r.id where r.id = $1`,
        [together],
      )
      expect(kept.rows).toEqual([{ note: 'together', has_companion: true }])
      // A record that needs no companion commits on its own.
      const plain = await as(`insert into ${record} (note) values ('on its own') returning needs_companion`)
      expect(plain.rows).toEqual([{ needs_companion: false }])
    })

    it('the check reads the row as it stands at commit, not as the insert wrote it: a need that appears after the insert is refused, one withdrawn before the commit passes', async () => {
      const record = qualified('fixture_record')

      const lateNeed = await failure(
        asPractice(app, practice, async (client) => {
          const inserted = await client.query(`insert into ${record} (note) values ('needs it later') returning id`)
          await client.query(`update ${record} set needs_companion = true where id = $1`, [inserted.rows[0].id])
        }),
      )
      expect(lateNeed).toMatchObject({ code: INCOMPLETE_RULE_CODE })
      expect(ruleOf(lateNeed)).toBe('vetora.incomplete_fixture_companion')

      const withdrawn = await asPractice(app, practice, async (client) => {
        const inserted = await client.query(
          `insert into ${record} (note, needs_companion) values ('changes its mind', true) returning id`,
        )
        await client.query(`update ${record} set needs_companion = false where id = $1`, [inserted.rows[0].id])
        return inserted.rows[0].id as string
      })
      const kept = await as(`select needs_companion from ${record} where id = $1`, [withdrawn])
      expect(kept.rows).toEqual([{ needs_companion: false }])
    })
  })

  describe('AC-13 occurred_at: never in the future, back datable within practice_settings.backdate_limit_hours (spec 0002, Conventions: Time; Value sourcing)', () => {
    const tooFar = refusal('vetora.backdated_too_far')
    const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000)

    it('one hour ahead fails the check constraint; two days back fails vetora.backdated_too_far under the default 24 hours; changing backdate_limit_hours changes the window; an old row stays editable while its occurred_at stands', async () => {
      const record = qualified('fixture_record')
      const settings = `${schema}.practice_settings`
      const insertAt = (occurredAt: Date) =>
        as(`insert into ${record} (note, occurred_at) values ('timed', $1) returning id`, [occurredAt])

      expect(await failure(insertAt(hoursAgo(-1)))).toMatchObject({
        code: '23514',
        constraint: 'fixture_record_occurred_at_check',
      })
      const stale = await failure(insertAt(hoursAgo(48)))
      expect(stale).toMatchObject(tooFar)
      expect(ruleOf(stale)).toBe('vetora.backdated_too_far')
      const recent = await insertAt(hoursAgo(23))
      expect(recent.rowCount).toBe(1)

      await as(`update ${settings} set backdate_limit_hours = 72`)
      expect((await insertAt(hoursAgo(48))).rowCount).toBe(1)
      expect(await failure(insertAt(hoursAgo(96)))).toMatchObject(tooFar)

      // Moving occurred_at is measured the same way; a change that leaves it alone is not, however old the row.
      const id = recent.rows[0].id
      expect(
        await failure(as(`update ${record} set occurred_at = $2 where id = $1`, [id, hoursAgo(96)])),
      ).toMatchObject(tooFar)
      await as(`update ${settings} set backdate_limit_hours = 1`)
      const noted = await as(`update ${record} set note = 'still editable' where id = $1 returning note`, [id])
      expect(noted.rows).toEqual([{ note: 'still editable' }])
      await as(`update ${settings} set backdate_limit_hours = 24`)
    })

    it('the limit is a non negative number of hours (a check), and a practice without its settings row refuses every event rather than letting one through', async () => {
      const settings = `${schema}.practice_settings`
      expect(await failure(as(`update ${settings} set backdate_limit_hours = -1`))).toMatchObject({
        code: '23514',
        constraint: 'practice_settings_backdate_limit_hours_check',
      })
      await migrator.query('begin')
      try {
        await migrator.query(`delete from ${settings}`)
        expect(
          await failure(migrator.query(`insert into ${qualified('fixture_record')} (note) values ('no settings')`)),
        ).toMatchObject({ message: expect.stringContaining('practice_settings has no row') })
      } finally {
        await migrator.query('rollback')
      }
    })
  })
})
