import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { loadConfig } from './config.js'

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

let database: ReturnType<typeof drizzle> | undefined

/** The Drizzle instance over the pooled connection. Schemas arrive with the data model feature. */
export function db() {
  database ??= drizzle({ client: pooled() })
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
