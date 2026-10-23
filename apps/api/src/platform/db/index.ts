import { defineRelations, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { loadConfig } from '../config.js'
import * as controlSchema from './control-schema.js'
import * as practiceSchema from './practice-schema.js'

const { Pool } = pg

/**
 * Database access (spec 0001, "Tenancy and data topology", "Connections").
 * Request traffic goes through the pooler in transaction mode, so request code keeps no
 * session state beyond SET LOCAL and uses no named prepared statements. The direct pool
 * is for LISTEN and the worker, which later features add.
 */
let pooledPool: pg.Pool | undefined
let directPool: pg.Pool | undefined

export function pooled(): pg.Pool {
  pooledPool ??= new Pool({
    connectionString: loadConfig().DATABASE_URL_POOLED,
    max: 10,
    application_name: 'vetora-api',
  })
  return pooledPool
}

export function direct(): pg.Pool {
  directPool ??= new Pool({
    connectionString: loadConfig().DATABASE_URL_DIRECT,
    max: 2,
    application_name: 'vetora-api-direct',
  })
  return directPool
}

/**
 * Both schemas as one relational config (spec 0002, "Interface surface": Drizzle schema modules): control.practice
 * beside every practice table, so db().query names every table of both; the column types, minor_units as bigint and
 * lang_code as the three codes, come from the table declarations and reach select() and query alike. Relations
 * between tables arrive with the slices that need
 * them, as the second argument of defineRelations. The two schemas merge by export name (schema.test.ts checks that
 * none is exported by both). The practice tables are unqualified: a request reaches them only after SET LOCAL ROLE and
 * search_path (the request context, slice 1).
 */
const relations = defineRelations({ ...controlSchema, ...practiceSchema })

const connect = () => drizzle({ client: pooled(), relations })

let database: ReturnType<typeof connect> | undefined

/** The Drizzle instance over the pooled connection, typed with both schemas. */
export function db() {
  database ??= connect()
  return database
}

export async function checkDatabase(): Promise<'ok' | 'unavailable'> {
  try {
    await db().execute(sql`select 1`)
    return 'ok'
  } catch {
    return 'unavailable'
  }
}

export async function closeDatabase(): Promise<void> {
  await Promise.all([pooledPool?.end(), directPool?.end()])
  pooledPool = undefined
  directPool = undefined
  database = undefined
}
