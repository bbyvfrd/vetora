import pg from 'pg'
import type { Logger } from 'pino'
import { type TableClass, tableClasses } from './table-classes.js'

/**
 * The grants step (spec 0002, "Security model": Grants pass): after a practice schema is migrated, by migrate and by
 * provision-practice, the practice role's privileges are set from the table class registry, exactly: REVOKE ALL,
 * then the class's privileges. DELETE is granted on no class, so records retire by status (IN-6); vetora_app holds no
 * grant of its own on any practice table and reaches them only through SET ROLE; vetora_backup reads everything for
 * dumps. GRANT and REVOKE repeat safely, so the step is idempotent.
 */

/** What each class lets the practice role do (spec 0002, "Conventions": Table classes); set once narrows to named columns with the grants ticket. */
const privilegesByClass: Record<TableClass, readonly string[]> = {
  append_only: ['INSERT', 'SELECT'],
  set_once: ['INSERT', 'SELECT', 'UPDATE'],
  mutable: ['INSERT', 'SELECT', 'UPDATE'],
  frozen_by_status: ['INSERT', 'SELECT', 'UPDATE'],
  function_written: ['SELECT'],
}

export type GrantTarget = {
  /** The practice schema, p_<id>. */
  schema: string
  /** The practice's no login role, p_<id>_role. */
  role: string
}

/** Set the practice role's privileges on the schema's registered tables, in one transaction. */
export async function applyGrants(client: pg.Client, { schema, role }: GrantTarget, log: Logger): Promise<void> {
  const schemaId = pg.escapeIdentifier(schema)
  const roleId = pg.escapeIdentifier(role)
  await client.query('begin')
  try {
    await client.query(`grant usage on schema ${schemaId} to ${roleId}, vetora_backup`)
    // The extensions live in ext once for every practice (spec 0002, "Conventions": Schemas).
    await client.query(`grant usage on schema ext to ${roleId}`)
    for (const [table, tableClass] of tableClasses) {
      const tableId = `${schemaId}.${pg.escapeIdentifier(table)}`
      await client.query(`revoke all on table ${tableId} from ${roleId}`)
      await client.query(`grant ${privilegesByClass[tableClass].join(', ')} on table ${tableId} to ${roleId}`)
    }
    await client.query(`grant select on all tables in schema ${schemaId} to vetora_backup`)
    await client.query(`grant select on all sequences in schema ${schemaId} to vetora_backup`)
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  }
  log.info({ schema, role, tables: tableClasses.size }, 'grants applied')
}
