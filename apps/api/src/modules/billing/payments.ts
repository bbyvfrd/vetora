import { eq, sql } from 'drizzle-orm'
import type { CurrencyCode } from '../../platform/db/domains.js'
import { practiceDayOf } from '../../platform/db/platform-tables.js'
import { practiceContext } from '../../platform/request-context.js'
import { type InvoiceView, issueLocked, written } from './invoices.js'
import { invoice, ledgerEntry, payment, paymentAllocation } from './schema.js'

/**
 * Take payment (spec #18, "Visit and money behaviour": Take payment; stories 62 to 67; #26), in the request's
 * transaction: the invoice locked, issued first when it is a draft (#25's issue), then the payment taken now at the
 * request's location and received by the actor, its ledger entry moving the client's balance, and its allocation to the
 * invoice. Partial by default (BL-5): any amount above zero up to what is still owed. The database holds the rules
 * whatever this code does: the entry at commit (vetora.incomplete_payment), the allocations within the invoice's total
 * and the payment's amount (vetora.incomplete_allocation), a payment and its allocation never changed (AC-9).
 */

/** How a payment was made at the desk; a bank transfer waits for feature 8. */
export type PaymentMethod = 'cash' | 'card'

export type PaymentOutcome =
  /** Taken now, or already taken under this id against this invoice (a retry): the invoice as it now stands. */
  | { status: 'paid' | 'existing'; invoice: InvoiceView }
  /** The payment id names a payment of another invoice. */
  | { status: 'taken' }
  /** Another change came first: the version is stale. */
  | { status: 'stale' }
  /** No such invoice, or a discarded one. */
  | { status: 'missing' }
  /** The amount is above what is still owed; nothing was written. */
  | { status: 'above-remainder' }

/** Whether a payment id is taken already: by a payment of this invoice (a retry), by another's, or not at all. */
async function paymentTaken(paymentId: string, invoiceId: string): Promise<'this' | 'other' | undefined> {
  const { db } = practiceContext()
  const [row] = await db
    .select({
      ofThis: sql<boolean>`exists (select 1 from ${paymentAllocation}
        where ${paymentAllocation.paymentId} = ${payment.id} and ${paymentAllocation.invoiceId} = ${invoiceId})`,
    })
    .from(payment)
    .where(eq(payment.id, paymentId))
  if (!row) return undefined
  return row.ofThis ? 'this' : 'other'
}

/**
 * Take a payment of `amountMinor` for an invoice against the version the person read. The invoice row is locked before
 * anything is read, so a second payment waits for this one and counts it (spec 0002, payment_allocation: "the handler
 * locks the invoice row first"); a retry with the same payment id changes nothing, whatever the version, since a
 * payment that issued a draft moved the version on.
 */
export async function takePayment(input: {
  invoiceId: string
  version: number
  payment: { id: string; amountMinor: bigint; method: PaymentMethod }
}): Promise<PaymentOutcome> {
  const { db, location, actor } = practiceContext()
  const [row] = await db
    .select({
      status: invoice.status,
      version: invoice.version,
      clientId: invoice.clientId,
      currency: invoice.currency,
    })
    .from(invoice)
    .where(eq(invoice.id, input.invoiceId))
    .for('update')
  if (!row || (row.status !== 'draft' && row.status !== 'issued')) return { status: 'missing' }
  const taken = await paymentTaken(input.payment.id, input.invoiceId)
  if (taken === 'this') return { status: 'existing', invoice: await written(input.invoiceId) }
  if (taken === 'other') return { status: 'taken' }
  if (row.version !== input.version) return { status: 'stale' }
  if (input.payment.amountMinor > (await written(input.invoiceId)).remainderMinor) return { status: 'above-remainder' }

  if (row.status === 'draft') await issueLocked(input.invoiceId)
  // The moment it was taken, and the practice's day of that moment, which the day close counts it in (spec 0002,
  // "Value sourcing": Record a payment).
  const occurredAt = sql`now()`
  const inserted = await db
    .insert(payment)
    .values({
      id: input.payment.id,
      locationId: location.id,
      clientId: row.clientId,
      method: input.payment.method,
      amountMinor: input.payment.amountMinor,
      currency: row.currency,
      occurredAt,
      businessDate: practiceDayOf(occurredAt),
      receivedBy: actor.id,
    })
    .onConflictDoNothing({ target: payment.id })
    .returning({ id: payment.id })
  // The id came in beside this request, for another invoice: the lock above does not hold that one.
  if (inserted.length === 0) return { status: 'taken' }
  await db.insert(ledgerEntry).values({
    clientId: row.clientId,
    kind: 'payment',
    amountMinor: -input.payment.amountMinor,
    currency: row.currency,
    paymentId: input.payment.id,
  })
  await db.insert(paymentAllocation).values({
    paymentId: input.payment.id,
    invoiceId: input.invoiceId,
    amountMinor: input.payment.amountMinor,
  })
  return { status: 'paid', invoice: await written(input.invoiceId) }
}

/** A client's balance (BL-6; spec 0002, "Value sourcing": Show a client's balance): positive is Balance due, negative a Prepayment. */
export type ClientBalance = { amountMinor: bigint; currency: CurrencyCode }

/**
 * A client's balance read from `client_balance`, the sum of their ledger rows; null for a client with none. One
 * currency per practice today, so one row at most.
 */
export async function clientBalance(clientId: string): Promise<ClientBalance | null> {
  const { db } = practiceContext()
  const result = await db.execute<{ balance_minor: string; currency: CurrencyCode }>(
    sql`select balance_minor, currency from client_balance where client_id = ${clientId}`,
  )
  const [row] = result.rows
  return row ? { amountMinor: BigInt(row.balance_minor), currency: row.currency } : null
}
