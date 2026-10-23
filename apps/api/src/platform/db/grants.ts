import pg from 'pg'
import {
  AUDIT_LOG_TABLE,
  grantOf,
  MIGRATIONS_TABLE,
  type TableClass,
  type TableClassRegistry,
  tableClassRegistry,
} from './table-classes.js'

/**
 * The grants pass (spec 0002, "Security model": Grants pass), run by migratePractice() inside each practice schema's
 * migration transaction, for migrate and provision-practice alike. It reads the live catalog (pg_class, pg_attribute,
 * pg_trigger, pg_proc), never the registry alone, refuses the schema when it and the table class registry
 * (table-classes.ts) disagree, then sets the practice role's privileges from the registry exactly: REVOKE ALL on the
 * schema and every relation and routine in it first, from the practice role, PUBLIC, and vetora_app alike, then the
 * class's privileges, column by column where the class narrows UPDATE. DELETE is granted on no class, so records retire
 * by status (IN-6); no function is executable by PUBLIC and only the registered ones by the practice role; vetora_app
 * holds no grant of its own on any practice table and reaches them only through SET ROLE; vetora_backup reads
 * everything for dumps. GRANT and REVOKE repeat safely, so the pass is idempotent, and it commits with the batch or
 * not at all.
 */

type TriggerEvent = 'INSERT' | 'UPDATE' | 'DELETE'

/** One of the two triggers every practice table but the audit log carries: its name, which is also its function's, and when it fires. */
type SharedTrigger = { name: string; timing: 'BEFORE' | 'AFTER'; events: readonly TriggerEvent[] }

/**
 * The two shared triggers as the migrations attach them (IN-1, AC-8; spec 0002, "Security model": Audit is mandatory):
 * each FOR EACH ROW, enabled, running the function of its name in the same schema.
 */
const SHARED_TRIGGERS: readonly SharedTrigger[] = [
  { name: 'set_updated_at', timing: 'BEFORE', events: ['INSERT', 'UPDATE'] },
  { name: 'audit_row', timing: 'AFTER', events: ['INSERT', 'UPDATE', 'DELETE'] },
]

/** The bits of pg_trigger.tgtype (pg_trigger.h); TRUNCATE (1 << 5) and INSTEAD (1 << 6) are in no shared trigger. */
const TRIGGER_TYPE = { ROW: 1 << 0, BEFORE: 1 << 1, INSERT: 1 << 2, DELETE: 1 << 3, UPDATE: 1 << 4 } as const

/** The tgtype a shared trigger must have, exactly: row level, its timing, its events and no other. */
const triggerType = ({ timing, events }: SharedTrigger): number =>
  events.reduce(
    (type, event) => type | TRIGGER_TYPE[event],
    TRIGGER_TYPE.ROW | (timing === 'BEFORE' ? TRIGGER_TYPE.BEFORE : 0),
  )

export type GrantTarget = {
  /** The practice schema, p_<id>. */
  schema: string
  /** The practice's no login role, p_<id>_role. */
  role: string
}

/** What one pass granted, for the command's log: every table with its class and privileges, the views and functions. */
export type Granted = {
  tables: Record<string, { class: TableClass; privileges: string[] }>
  views: string[]
  functions: string[]
}

/**
 * The pass refused the schema because it and the table class registry disagree; `problems` names each disagreement
 * by table, view, function, trigger, or column name, never a value, so the message can be logged.
 */
export class TableClassMismatch extends Error {
  constructor(
    schema: string,
    readonly problems: readonly string[],
  ) {
    super(`the grants pass refused ${schema}: ${problems.join('; ')}`)
    this.name = 'TableClassMismatch'
  }
}

/**
 * Set the practice role's privileges on the schema from the registry, inside the caller's transaction (the schema's
 * migration transaction under the commands; a rolled back one in the tests). Throws TableClassMismatch, before any
 * GRANT, when the schema holds a table with no class or a view with no entry, an entry has no object behind it, a
 * table other than audit_event lacks a shared trigger or carries it disabled, changed, or running another function,
 * or an entry names a column the table does not have.
 */
export async function applyGrants(
  client: pg.Client,
  { schema, role }: GrantTarget,
  registry: TableClassRegistry = tableClassRegistry,
): Promise<Granted> {
  const catalog = await readCatalog(client, schema)
  const problems = mismatches(schema, catalog, registry)
  if (problems.length > 0) throw new TableClassMismatch(schema, problems)

  const schemaId = pg.escapeIdentifier(schema)
  const roleId = pg.escapeIdentifier(role)
  const qualified = (name: string) => `${schemaId}.${pg.escapeIdentifier(name)}`

  // Start from nothing: for the practice role, and for the two that must hold nothing of their own here, PUBLIC, whose
  // grants every role inherits, and vetora_app, which reaches a practice only through SET ROLE (spec 0002, "Security
  // model": Roles; AC-11). Whatever an earlier pass, a migration, or a hand GRANT gave them goes: the schema, every
  // table (DELETE, TRUNCATE, REFERENCES, TRIGGER; the migrations table included), every sequence, every routine.
  const revoked = `${roleId}, public, vetora_app`
  await client.query(`revoke all on schema ${schemaId} from ${revoked}`)
  await client.query(`revoke all on all tables in schema ${schemaId} from ${revoked}`)
  await client.query(`revoke all on all sequences in schema ${schemaId} from ${revoked}`)
  // A function is callable by the practice role only when registered, and by PUBLIC never (spec 0002, Owner run functions).
  await client.query(`revoke all on all routines in schema ${schemaId} from ${revoked}`)

  await client.query(`grant usage on schema ${schemaId} to ${roleId}, vetora_backup`)
  // The extensions live in ext once for every practice (spec 0002, "Conventions": Schemas).
  await client.query(`grant usage on schema ext to ${roleId}`)

  const tables: Granted['tables'] = {}
  for (const [table, entry] of registry.tables) {
    const { privileges, updateColumns } = grantOf(entry, catalog.relations.get(table)?.columns ?? [])
    await client.query(`grant ${privileges.join(', ')} on table ${qualified(table)} to ${roleId}`)
    if (updateColumns) {
      const list = updateColumns.map((column) => pg.escapeIdentifier(column)).join(', ')
      await client.query(`grant update (${list}) on table ${qualified(table)} to ${roleId}`)
    }
    tables[table] = {
      class: entry.class,
      privileges: updateColumns ? [...privileges, `UPDATE (${updateColumns.join(', ')})`] : [...privileges],
    }
  }
  for (const view of registry.views) await client.query(`grant select on table ${qualified(view)} to ${roleId}`)
  for (const name of registry.functions) {
    for (const signature of catalog.functions.get(name) ?? []) {
      await client.query(`grant execute on function ${signature} to ${roleId}`)
    }
  }

  // Dumps read everything, the migrations table and its sequence included.
  await client.query(`grant select on all tables in schema ${schemaId} to vetora_backup`)
  await client.query(`grant select on all sequences in schema ${schemaId} to vetora_backup`)

  return { tables, views: [...registry.views], functions: [...registry.functions] }
}

/** Every way the schema and the registry disagree: the schema's objects first, then the registry's entries; empty when they agree. */
function mismatches(schema: string, catalog: Catalog, registry: TableClassRegistry): string[] {
  const problems: string[] = []
  const registered = (name: string) => registry.tables.has(name) || registry.views.has(name)
  for (const [name, { kind }] of catalog.relations) {
    if (kind === 'table' && !registered(name)) problems.push(`table "${name}" has no class in table-classes.ts`)
  }
  for (const [name, { kind }] of catalog.relations) {
    if (kind === 'view' && !registered(name)) problems.push(`view "${name}" is not registered in table-classes.ts`)
  }
  for (const [name, entry] of registry.tables) {
    const relation = catalog.relations.get(name)
    if (!relation) {
      problems.push(`table "${name}" is registered but not in the schema`)
      continue
    }
    if (relation.kind !== 'table') {
      problems.push(`table "${name}" is registered but "${name}" is a view`)
      continue
    }
    if (name !== AUDIT_LOG_TABLE) problems.push(...triggerProblems(schema, name, relation.triggers))
    for (const column of grantOf(entry, relation.columns).namedColumns) {
      if (!relation.columns.includes(column)) {
        problems.push(`column "${column}" of table "${name}" is named in table-classes.ts but not in the schema`)
      }
    }
  }
  for (const name of registry.views) {
    const relation = catalog.relations.get(name)
    if (!relation) problems.push(`view "${name}" is registered but not in the schema`)
    else if (relation.kind !== 'view') problems.push(`view "${name}" is registered but "${name}" is a table`)
  }
  for (const name of registry.functions) {
    if (!catalog.functions.has(name)) problems.push(`function "${name}" is registered but not in the schema`)
  }
  return problems
}

/** How a table's copy of each shared trigger departs from the one the migrations attach: missing, disabled, another function, another firing. */
function triggerProblems(schema: string, table: string, triggers: readonly Trigger[]): string[] {
  const problems: string[] = []
  for (const shared of SHARED_TRIGGERS) {
    const trigger = triggers.find((candidate) => candidate.name === shared.name)
    if (!trigger) {
      problems.push(`table "${table}" has no ${shared.name} trigger`)
      continue
    }
    if (!trigger.enabled) problems.push(`table "${table}" has its ${shared.name} trigger disabled`)
    if (trigger.function !== shared.name || trigger.functionSchema !== schema) {
      const runs =
        trigger.functionSchema === schema ? trigger.function : `${trigger.functionSchema}.${trigger.function}`
      problems.push(`table "${table}" has its ${shared.name} trigger running ${runs}() instead of ${shared.name}()`)
    }
    if (trigger.type !== triggerType(shared)) {
      const firing = `${shared.timing} ${shared.events.join(' OR ')} FOR EACH ROW`
      problems.push(`table "${table}" has its ${shared.name} trigger not firing ${firing}`)
    }
  }
  return problems
}

/** A trigger as the catalog holds it: its function (by name and schema), whether it is enabled, and its tgtype. */
type Trigger = { name: string; function: string; functionSchema: string; enabled: boolean; type: number }

/** A table or view of the schema as the catalog holds it. */
type Relation = { kind: 'table' | 'view'; columns: string[]; triggers: Trigger[] }

type Catalog = {
  /** Every table and view of the schema but the migrations table, by name, in name order. */
  relations: Map<string, Relation>
  /** Every function and procedure of the schema: name → the qualified signatures of its overloads, as GRANT names them. */
  functions: Map<string, string[]>
}

/** The schema as it is now, inside the transaction: tables, views, their columns and triggers, and the routines. */
async function readCatalog(client: pg.Client, schema: string): Promise<Catalog> {
  const relations = await client.query<{
    name: string
    kind: Relation['kind']
    columns: string[]
    triggers: Trigger[]
  }>(
    `select c.relname as name,
            case when c.relkind in ('r', 'p') then 'table' else 'view' end as kind,
            coalesce((select array_agg(a.attname::text order by a.attnum) from pg_attribute a
                      where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped), '{}') as columns,
            coalesce((select jsonb_agg(jsonb_build_object(
                        'name', t.tgname, 'function', p.proname, 'functionSchema', pn.nspname,
                        'enabled', t.tgenabled <> 'D', 'type', t.tgtype) order by t.tgname)
                      from pg_trigger t
                      join pg_proc p on p.oid = t.tgfoid
                      join pg_namespace pn on pn.oid = p.pronamespace
                      where t.tgrelid = c.oid and not t.tgisinternal), '[]') as triggers
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = $1 and c.relkind in ('r', 'p', 'v', 'm') and c.relname <> $2
     order by c.relname`,
    [schema, MIGRATIONS_TABLE],
  )
  const routines = await client.query<{ name: string; signature: string }>(
    `select p.proname as name,
            format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as signature
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = $1 order by p.proname, p.oid`,
    [schema],
  )
  const functions = new Map<string, string[]>()
  for (const { name, signature } of routines.rows) functions.set(name, [...(functions.get(name) ?? []), signature])
  return {
    relations: new Map(relations.rows.map(({ name, ...relation }) => [name, relation])),
    functions,
  }
}
