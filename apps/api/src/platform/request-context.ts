import { AsyncLocalStorage } from 'node:async_hooks'
import type { StaffRole } from '@vetora/contracts'
import type { Logger } from 'pino'
import type { PracticeTransaction } from './db/practice-transaction.js'

/**
 * The request context of a practice route (spec 0001, "Tenancy and data topology": Request context; spec #18): what a
 * handler, and a module's public interface it calls, reads instead of taking it as arguments. The request context
 * middleware (src/http/practice-context.ts) fills it once the session, the membership, the registry, the location and
 * the route's action have been checked, and runs the handler inside it, in the one transaction it opened in the
 * practice. Outside a practice route there is none, and practiceContext() throws.
 */
export type PracticeContext = {
  practice: { id: string; slug: string }
  /** The location the request acts at, one of the practice's active locations (IN-5). */
  location: { id: string }
  /** Who acts (IN-1): the session's person today, whoever unlocked with their PIN from feature 15. */
  actor: { id: string; roles: readonly StaffRole[] }
  /** The request's transaction, switched to the practice's role and schema with app.actor_id set. */
  db: PracticeTransaction
  /** The request's logger, carrying its request id: ids and durations only, never a name or a phone. */
  log: Logger
}

const storage = new AsyncLocalStorage<PracticeContext>()

/** Run `work` with the context, which every call it makes, awaited or not, reads through practiceContext(). */
export function withPracticeContext<T>(context: PracticeContext, work: () => Promise<T>): Promise<T> {
  return storage.run(context, work)
}

/**
 * The context of the practice route being served; throws outside one, so a query can never run outside the
 * practice's transaction by accident.
 * @public
 */
export function practiceContext(): PracticeContext {
  const context = storage.getStore()
  if (!context) throw new Error('no practice context: this code runs only inside a practice route')
  return context
}
