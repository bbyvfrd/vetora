import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import type { CurrencyCode } from '../../platform/db/domains.js'
import { practiceContext } from '../../platform/request-context.js'
import { type PricedService, serviceForLine } from '../inventory/index.js'
import { invoice, invoiceLine, ledgerEntry } from './schema.js'

/**
 * A visit's invoice (spec #18, "Visit and money behaviour": the invoice; #25): the draft created with its first line
 * from the visit page, lines added from the price list, a quantity changed or a line removed while it is a draft, and
 * Issue invoice, which takes the next number and writes the client's charge. Everything runs in the request's
 * transaction (practiceContext()). Billing never reads clinical internals (BL-2): the visit, patient and client ids
 * are stored as given. The database holds the rules whatever this code does: a line's snapshot fixed at insert, the
 * freeze of an issued invoice and its lines (vetora.frozen_record), and the charge equal to the live lines at commit
 * (vetora.incomplete_invoice), each surfacing as the request's 409.
 */

/** The live statuses: a visit has at most one invoice in them (`invoice_encounter_live_idx`). */
const LIVE = ['draft', 'issued'] as const

/** An invoice as the card shows it: its live lines, and its totals worked out from them. */
export type InvoiceView = {
  id: string
  status: 'draft' | 'issued'
  version: number
  number: string | null
  issuedAt: Date | null
  visitId: string | null
  patientId: string | null
  clientId: string | null
  currency: CurrencyCode
  lines: {
    id: string
    serviceId: string | null
    description: { az: string | null; ru: string | null; en: string | null }
    quantity: number
    unitPriceMinor: bigint
    totalMinor: bigint
  }[]
  totalMinor: bigint
  paidMinor: bigint
  remainderMinor: bigint
}

/** How a change against a version ended: the invoice as it now stands, a stale version, or no such invoice. */
export type InvoiceChange = { status: 'changed'; invoice: InvoiceView } | { status: 'stale' } | { status: 'missing' }

export type LineOutcome =
  | InvoiceChange
  /** The line is already on this invoice (a retry): the invoice as it stands. */
  | { status: 'existing'; invoice: InvoiceView }
  /** The line id names a line of another invoice. */
  | { status: 'taken' }
  /** No such service on the price list, or one no longer active. */
  | { status: 'no-service' }

export type CreateOutcome =
  | { status: 'created' | 'existing'; invoice: InvoiceView }
  /** The invoice id names another visit's invoice. */
  | { status: 'taken' }
  /** The visit already has a live invoice under another id. */
  | { status: 'visit-invoiced' }
  | { status: 'no-service' }

/** The invoice by id with its live lines and totals; undefined when there is none, or it was discarded. */
export async function readInvoice(id: string): Promise<InvoiceView | undefined> {
  const { db } = practiceContext()
  const [row] = await db
    .select()
    .from(invoice)
    .where(and(eq(invoice.id, id), ne(invoice.status, 'discarded')))
  // A void invoice (feature 8) is not live either; nothing makes one yet.
  if (!row || (row.status !== 'draft' && row.status !== 'issued')) return undefined
  const lines = await db
    .select()
    .from(invoiceLine)
    .where(and(eq(invoiceLine.invoiceId, id), isNull(invoiceLine.removedAt)))
    .orderBy(asc(invoiceLine.sort), asc(invoiceLine.id))
  const totalMinor = lines.reduce((sum, line) => sum + line.totalMinor, 0n)
  // Payments and their allocations arrive with #26: nothing is paid yet.
  const paidMinor = 0n
  return {
    id: row.id,
    status: row.status,
    version: row.version,
    number: row.number,
    issuedAt: row.issuedAt,
    visitId: row.encounterId,
    patientId: row.patientId,
    clientId: row.clientId,
    currency: row.currency,
    lines: lines.map((line) => ({
      id: line.id,
      serviceId: line.serviceId,
      description: { az: line.descriptionAz, ru: line.descriptionRu, en: line.descriptionEn },
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      totalMinor: line.totalMinor,
    })),
    totalMinor,
    paidMinor,
    remainderMinor: totalMinor - paidMinor,
  }
}

/** The invoice just written; the key holds it, so its absence is a fault. */
async function written(id: string): Promise<InvoiceView> {
  const view = await readInvoice(id)
  if (!view) throw new Error('an invoice just written is not there')
  return view
}

/**
 * Write a service line (spec 0002, "Value sourcing": Add an invoice line): the service's three names and its price
 * now, snapshotted; the total the quantity times the price, rounded half up in the database's numeric arithmetic, so
 * the line's check and the line agree to the minor unit; placed after the invoice's other lines. False when the id is
 * already a line (of this invoice or another).
 */
async function insertLine(invoiceId: string, line: { id: string; quantity: number }, priced: PricedService) {
  const { db } = practiceContext()
  const inserted = await db
    .insert(invoiceLine)
    .values({
      id: line.id,
      invoiceId,
      kind: 'service',
      serviceId: priced.id,
      descriptionAz: priced.names.az,
      descriptionRu: priced.names.ru,
      descriptionEn: priced.names.en,
      quantity: line.quantity,
      unitPriceMinor: priced.priceMinor,
      totalMinor: sql`round(${line.quantity}::numeric * ${priced.priceMinor})`,
      sort: sql`(select coalesce(max(${invoiceLine.sort}), 0) + 1 from ${invoiceLine} where ${invoiceLine.invoiceId} = ${invoiceId})`,
    })
    .onConflictDoNothing({ target: invoiceLine.id })
    .returning({ id: invoiceLine.id })
  return inserted.length > 0
}

/** Which invoice a line id already belongs to, if any. */
async function invoiceOfLine(lineId: string): Promise<string | undefined> {
  const { db } = practiceContext()
  const [row] = await db
    .select({ invoiceId: invoiceLine.invoiceId })
    .from(invoiceLine)
    .where(eq(invoiceLine.id, lineId))
  return row?.invoiceId
}

/**
 * Create a visit's draft invoice with its first line (spec #18: "the draft invoice is created with its first line
 * from the visit page"), at the request's location, in its first service's currency (AZN, the one the money domain
 * allows; a line of another currency waits for a second one). The same id again for the same visit
 * changes nothing and answers the invoice as it stands.
 */
export async function createInvoice(input: {
  id: string
  visitId: string
  patientId: string
  clientId: string
  line: { id: string; serviceId: string; quantity: number }
}): Promise<CreateOutcome> {
  const { db, location } = practiceContext()
  const [stored] = await db.select({ visitId: invoice.encounterId }).from(invoice).where(eq(invoice.id, input.id))
  if (stored) {
    if (stored.visitId !== input.visitId) return { status: 'taken' }
    const view = await readInvoice(input.id)
    // A retry of a create whose invoice the visit's cancel since discarded: it reads as another visit's.
    return view ? { status: 'existing', invoice: view } : { status: 'taken' }
  }
  const priced = await serviceForLine(input.line.serviceId)
  if (!priced) return { status: 'no-service' }
  // No target: the id, or the visit's one live invoice (a draft made beside this one by another tab), refuses it.
  const created = await db
    .insert(invoice)
    .values({
      id: input.id,
      locationId: location.id,
      encounterId: input.visitId,
      patientId: input.patientId,
      clientId: input.clientId,
      currency: priced.currency,
    })
    .onConflictDoNothing()
    .returning({ id: invoice.id })
  if (created.length === 0) {
    const [raced] = await db.select({ visitId: invoice.encounterId }).from(invoice).where(eq(invoice.id, input.id))
    if (!raced) return { status: 'visit-invoiced' }
    return raced.visitId === input.visitId
      ? { status: 'existing', invoice: await written(input.id) }
      : { status: 'taken' }
  }
  if (!(await insertLine(input.id, input.line, priced))) return { status: 'taken' }
  return { status: 'created', invoice: await written(input.id) }
}

/**
 * Lock an invoice for a change against the version the person read (lock_parent()'s rule: the parent first, then its
 * lines): undefined when it may go ahead, else why not. A discarded invoice reads as gone; an issued one goes ahead,
 * and the database's freeze then refuses the change.
 */
async function lockForChange(id: string, version: number): Promise<InvoiceChange | undefined> {
  const { db } = practiceContext()
  const [row] = await db
    .select({ status: invoice.status, version: invoice.version })
    .from(invoice)
    .where(eq(invoice.id, id))
    .for('update')
  if (!row || row.status === 'discarded' || row.status === 'void') return { status: 'missing' }
  if (row.version !== version) return { status: 'stale' }
  return undefined
}

/** A change to the lines moves the invoice's version on, so the next change is made against what it changed. */
async function bumpVersion(id: string): Promise<InvoiceView> {
  const { db } = practiceContext()
  await db.update(invoice).set({ updatedAt: sql`now()` }).where(eq(invoice.id, id))
  return written(id)
}

/**
 * Add a service line to a draft invoice (story 57) against its version. The same line id again on this invoice
 * changes nothing, whatever the version, and answers the invoice as it stands.
 */
export async function addLine(
  invoiceId: string,
  version: number,
  line: { id: string; serviceId: string; quantity: number },
): Promise<LineOutcome> {
  const owner = await invoiceOfLine(line.id)
  if (owner !== undefined) {
    const view = owner === invoiceId ? await readInvoice(invoiceId) : undefined
    return view ? { status: 'existing', invoice: view } : { status: 'taken' }
  }
  const refused = await lockForChange(invoiceId, version)
  if (refused) return refused
  const priced = await serviceForLine(line.serviceId)
  if (!priced) return { status: 'no-service' }
  if (!(await insertLine(invoiceId, line, priced))) return { status: 'taken' }
  return { status: 'changed', invoice: await bumpVersion(invoiceId) }
}

/**
 * Change a draft line's quantity (story 58), its total worked out again from the unit price it snapshotted; `missing`
 * also when the line is not a live line of this invoice.
 */
export async function setQuantity(
  invoiceId: string,
  version: number,
  lineId: string,
  quantity: number,
): Promise<InvoiceChange> {
  const { db } = practiceContext()
  const refused = await lockForChange(invoiceId, version)
  if (refused) return refused
  const changed = await db
    .update(invoiceLine)
    .set({ quantity, totalMinor: sql`round(${quantity}::numeric * ${invoiceLine.unitPriceMinor})` })
    .where(and(eq(invoiceLine.id, lineId), eq(invoiceLine.invoiceId, invoiceId), isNull(invoiceLine.removedAt)))
    .returning({ id: invoiceLine.id })
  if (changed.length === 0) return { status: 'missing' }
  return { status: 'changed', invoice: await bumpVersion(invoiceId) }
}

/** Remove a mistaken line from a draft invoice (story 58); it stays in the table, left out of every total. */
export async function removeLine(invoiceId: string, version: number, lineId: string): Promise<InvoiceChange> {
  const { db } = practiceContext()
  const refused = await lockForChange(invoiceId, version)
  if (refused) return refused
  const removed = await db
    .update(invoiceLine)
    .set({ removedAt: sql`now()` })
    .where(and(eq(invoiceLine.id, lineId), eq(invoiceLine.invoiceId, invoiceId), isNull(invoiceLine.removedAt)))
    .returning({ id: invoiceLine.id })
  if (removed.length === 0) return { status: 'missing' }
  return { status: 'changed', invoice: await bumpVersion(invoiceId) }
}

/**
 * Issue an invoice (story 59; spec 0002, "Value sourcing": Issue an invoice) against its version, in the request's
 * transaction: the invoice locked, the next gapless number and the moment set at once, then the client's charge equal
 * to its live lines' total (BL-6). An invoice already issued is the freeze's refusal; one with no live line is the
 * deferred check's at commit (vetora.incomplete_invoice), which also gives the number back.
 */
export async function issueInvoice(id: string, version: number): Promise<InvoiceChange> {
  const { db } = practiceContext()
  const refused = await lockForChange(id, version)
  if (refused) return refused
  const [issued] = await db
    .update(invoice)
    .set({ status: 'issued', number: sql`next_invoice_number()`, issuedAt: sql`now()` })
    .where(eq(invoice.id, id))
    .returning({ clientId: invoice.clientId, currency: invoice.currency })
  if (!issued) throw new Error('the locked invoice was not updated')
  const [total] = await db
    .select({ minor: sql<string>`coalesce(sum(${invoiceLine.totalMinor}), 0)` })
    .from(invoiceLine)
    .where(and(eq(invoiceLine.invoiceId, id), isNull(invoiceLine.removedAt)))
  await db.insert(ledgerEntry).values({
    clientId: issued.clientId,
    kind: 'charge',
    amountMinor: BigInt(total?.minor ?? '0'),
    currency: issued.currency,
    invoiceId: id,
  })
  return { status: 'changed', invoice: await written(id) }
}

/** The visit's live invoice, draft or issued; null when it has none. */
export async function visitInvoice(visitId: string): Promise<InvoiceView | null> {
  const { db } = practiceContext()
  const [row] = await db
    .select({ id: invoice.id })
    .from(invoice)
    .where(and(eq(invoice.encounterId, visitId), inArray(invoice.status, LIVE)))
  return row ? ((await readInvoice(row.id)) ?? null) : null
}

/**
 * The invoice state of each visit (spec #18, "Read models": Visits today): a draft, or issued and unpaid; a visit
 * missing from the map has none. Part paid and paid arrive with payments (#26).
 */
export async function invoiceStates(visitIds: readonly string[]): Promise<Map<string, 'draft' | 'unpaid'>> {
  if (visitIds.length === 0) return new Map()
  const { db } = practiceContext()
  const rows = await db
    .select({ visitId: invoice.encounterId, status: invoice.status })
    .from(invoice)
    .where(and(inArray(invoice.encounterId, [...visitIds]), inArray(invoice.status, LIVE)))
  return new Map(
    rows.flatMap(({ visitId, status }) =>
      visitId ? [[visitId, status === 'draft' ? 'draft' : 'unpaid'] as const] : [],
    ),
  )
}

/**
 * Cancel visit's question to billing (spec #18: "the clinical record module asks billing, through its public interface,
 * to discard the visit's draft invoice; billing refuses when that invoice is issued"): the visit's live invoice locked,
 * then a draft discarded with its lines, an issued one left as it is and refused.
 */
export async function discardVisitInvoice(visitId: string): Promise<'none' | 'discarded' | 'issued'> {
  const { db } = practiceContext()
  const [row] = await db
    .select({ id: invoice.id, status: invoice.status })
    .from(invoice)
    .where(and(eq(invoice.encounterId, visitId), inArray(invoice.status, LIVE)))
    .for('update')
  if (!row) return 'none'
  if (row.status !== 'draft') return 'issued'
  await db.update(invoice).set({ status: 'discarded' }).where(eq(invoice.id, row.id))
  return 'discarded'
}
