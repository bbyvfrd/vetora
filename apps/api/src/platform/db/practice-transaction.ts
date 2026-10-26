import { sql } from 'drizzle-orm'
import { db } from './index.js'

/**
 * One request transaction inside a practice (spec 0001, "Tenancy and data topology"; spec 0002, "Interface surface":
 * Request transaction): on the pooled vetora_app connection, `SET LOCAL ROLE` to the practice's role, `SET LOCAL
 * search_path` to its schema and ext, and `app.actor_id` with `app.request_id` for the transaction (IN-1;
 * docs/database.md, "Actor and audit"), so the unqualified practice tables of practice-schema.ts resolve to that
 * practice alone, every write names its actor, and its audit row the request. Nothing outlives the transaction, as the
 * pooler in transaction mode needs. `/api/me` reads its locations through it; the request context of #21 opens one
 * per practice route.
 */

export type PracticeRef = { schemaName: string; roleName: string }

/** Who acts in the transaction, and the request it serves (the request id hono/request-id gave it). */
export type RequestActor = { actorId: string; requestId?: string }

type Transaction = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0]

/** Run `work` in a transaction switched to the practice, as the actor: committed when it returns, rolled back when it throws. */
export function inPractice<T>(
  practice: PracticeRef,
  { actorId, requestId }: RequestActor,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db().transaction(async (tx) => {
    await tx.execute(sql`set local role ${sql.identifier(practice.roleName)}`)
    await tx.execute(sql`set local search_path to ${sql.identifier(practice.schemaName)}, ext`)
    await tx.execute(sql`select set_config('app.actor_id', ${actorId}, true)`)
    if (requestId) await tx.execute(sql`select set_config('app.request_id', ${requestId}, true)`)
    return work(tx)
  })
}
