import { createRoute, type RouteHandler } from '@hono/zod-openapi'
import {
  Invoice,
  InvoiceChangeHeaders,
  InvoiceLinePath,
  InvoicePath,
  LineQuantity,
  NewInvoice,
  NewLine,
  PracticeHeaders,
  PracticePath,
  Services,
  VisitInvoice,
  VisitPath,
  versionOfTag,
  versionTag,
} from '@vetora/contracts'
import type { Context } from 'hono'
import {
  addLine,
  createInvoice,
  type InvoiceChange,
  type InvoiceView,
  issueInvoice,
  type LineOutcome,
  removeLine,
  setQuantity,
  visitInvoice,
} from '../modules/billing/index.js'
import { readEncounter } from '../modules/clinical-record/index.js'
import { priceList } from '../modules/inventory/index.js'
import { problem } from '../platform/problem.js'
import type { Env } from './env.js'
import { practiceRoute, refusals } from './practice-context.js'

/**
 * The price list and a visit's invoice (#25; spec #18, "Visit and money behaviour": the invoice; stories 56 to 61),
 * each behind the request context with the action it performs: whoever invoices (a receptionist, an assistant, a vet,
 * the manager) searches the price list, creates the draft with its first line, adds, changes and removes lines while
 * it is a draft, and issues it; every role but the groomer reads the visit's invoice. The draft carries its UUID v7 and
 * each line its own, so a retry changes nothing; every later change carries the invoice's version in `If-Match` and
 * answers 412 when it is stale. What the database refuses (the freeze of an issued invoice, the charge at commit)
 * answers 409 naming its rule, through the request context.
 */

const invoiceContent = { content: { 'application/json': { schema: Invoice } } } as const

const changeRefusals = {
  404: { description: 'No such invoice, a discarded one, or no such line on it (problem details)' },
  409: {
    description: 'Refused by a rule of the record: issued, or issued without a line (problem details naming the rule)',
  },
  412: { description: 'Another change came first: the version is stale (problem details)' },
} as const

export const servicesRoute = createRoute({
  method: 'get',
  path: '/api/p/{practiceId}/services',
  middleware: [practiceRoute('invoiceAndTakePayment')],
  summary: 'The price list',
  description: 'The active services, each with its names in the three languages, its category and its price now.',
  request: { params: PracticePath, headers: PracticeHeaders },
  responses: {
    200: { description: 'The price list', content: { 'application/json': { schema: Services } } },
    ...refusals,
  },
})

export const visitInvoiceRoute = createRoute({
  method: 'get',
  path: '/api/p/{practiceId}/visits/{visitId}/invoice',
  middleware: [practiceRoute('readRecords')],
  summary: "A visit's invoice",
  description:
    "The visit's invoice, draft or issued, with its lines, Total, Paid and the remainder; null before its first line.",
  request: { params: VisitPath, headers: PracticeHeaders },
  responses: {
    200: { description: "The visit's invoice", content: { 'application/json': { schema: VisitInvoice } } },
    ...refusals,
  },
})

export const createInvoiceRoute = createRoute({
  method: 'put',
  path: '/api/p/{practiceId}/invoices/{invoiceId}',
  middleware: [practiceRoute('invoiceAndTakePayment')],
  summary: "Create a visit's draft invoice",
  description:
    "Creates the visit's draft invoice with its first line, at the request's location: the service's names and price snapshotted, the visit, patient and client stored as given once the API has checked they are the visit's. The invoice id is a UUID v7 the client generates: the same request again changes nothing.",
  request: {
    params: InvoicePath,
    headers: PracticeHeaders,
    body: { content: { 'application/json': { schema: NewInvoice } }, required: true },
  },
  responses: {
    200: { description: 'Created', ...invoiceContent },
    404: { description: 'No such visit, or a cancelled one; or no such active service (problem details)' },
    409: {
      description:
        "The patient or client is not the visit's, the visit already has an invoice, or an id is another invoice's or line's (problem details)",
    },
    ...refusals,
  },
})

export const addLineRoute = createRoute({
  method: 'put',
  path: '/api/p/{practiceId}/invoices/{invoiceId}/lines/{lineId}',
  middleware: [practiceRoute('invoiceAndTakePayment')],
  summary: 'Add a service to a draft invoice',
  description:
    "Adds a line for a service of the price list against the invoice's version in If-Match, its names and price snapshotted. The line id is a UUID v7 the client generates: the same line again changes nothing.",
  request: {
    params: InvoiceLinePath,
    headers: InvoiceChangeHeaders,
    body: { content: { 'application/json': { schema: NewLine } }, required: true },
  },
  responses: {
    200: { description: 'Added', ...invoiceContent },
    ...changeRefusals,
    ...refusals,
  },
})

export const quantityRoute = createRoute({
  method: 'put',
  path: '/api/p/{practiceId}/invoices/{invoiceId}/lines/{lineId}/quantity',
  middleware: [practiceRoute('invoiceAndTakePayment')],
  summary: "Change a draft line's quantity",
  description:
    "Sets the line's quantity against the invoice's version in If-Match; its total follows from its unit price.",
  request: {
    params: InvoiceLinePath,
    headers: InvoiceChangeHeaders,
    body: { content: { 'application/json': { schema: LineQuantity } }, required: true },
  },
  responses: {
    200: { description: 'Changed', ...invoiceContent },
    ...changeRefusals,
    ...refusals,
  },
})

export const removeLineRoute = createRoute({
  method: 'post',
  path: '/api/p/{practiceId}/invoices/{invoiceId}/lines/{lineId}/remove',
  middleware: [practiceRoute('invoiceAndTakePayment')],
  summary: 'Remove a line from a draft invoice',
  description: "Removes a mistaken line against the invoice's version in If-Match; it is left out of every total.",
  request: { params: InvoiceLinePath, headers: InvoiceChangeHeaders },
  responses: {
    200: { description: 'Removed', ...invoiceContent },
    ...changeRefusals,
    ...refusals,
  },
})

export const issueRoute = createRoute({
  method: 'post',
  path: '/api/p/{practiceId}/invoices/{invoiceId}/issue',
  middleware: [practiceRoute('invoiceAndTakePayment')],
  summary: 'Issue an invoice',
  description:
    "Issues the invoice against its version in If-Match, in one transaction: the next number, gapless per practice, and the client's charge equal to its lines' total, which becomes their Balance due. An invoice with no line is refused.",
  request: { params: InvoicePath, headers: InvoiceChangeHeaders },
  responses: {
    200: { description: 'Issued', ...invoiceContent },
    ...changeRefusals,
    ...refusals,
  },
})

/** The invoice on the wire: instants as ISO strings, money as whole minor units (IN-4). */
const asJson = (view: InvoiceView) => ({
  ...view,
  issuedAt: view.issuedAt?.toISOString() ?? null,
  lines: view.lines.map((line) => ({
    ...line,
    unitPriceMinor: Number(line.unitPriceMinor),
    totalMinor: Number(line.totalMinor),
  })),
  totalMinor: Number(view.totalMinor),
  paidMinor: Number(view.paidMinor),
  remainderMinor: Number(view.remainderMinor),
})

/** The answer with an invoice: its version as the entity tag, so the next change can send it back. */
function answer(c: Context<Env>, view: InvoiceView) {
  c.header('etag', versionTag(view.version))
  return c.json(asJson(view), 200)
}

/** The answer to a change against a version: the invoice, 412 when it was stale, 404 when there is none. */
function changed(c: Context<Env>, outcome: InvoiceChange) {
  switch (outcome.status) {
    case 'missing':
      return problem(c, 404, 'No such invoice or line')
    case 'stale':
      return problem(c, 412, 'The invoice changed since it was read')
    case 'changed':
      return answer(c, outcome.invoice)
  }
}

export const getServices: RouteHandler<typeof servicesRoute, Env> = async (c) => {
  const services = await priceList()
  return c.json({ services: services.map((item) => ({ ...item, priceMinor: Number(item.priceMinor) })) }, 200)
}

export const getVisitInvoice: RouteHandler<typeof visitInvoiceRoute, Env> = async (c) => {
  const view = await visitInvoice(c.req.valid('param').visitId)
  if (view) c.header('etag', versionTag(view.version))
  return c.json({ invoice: view ? asJson(view) : null }, 200)
}

export const putInvoice: RouteHandler<typeof createInvoiceRoute, Env> = async (c) => {
  const { invoiceId } = c.req.valid('param')
  const body = c.req.valid('json')
  const visit = await readEncounter(body.visitId)
  if (!visit) return problem(c, 404, 'No such visit')
  if (visit.patientId !== body.patientId || visit.clientId !== body.clientId) {
    return problem(c, 409, "The patient or client is not the visit's")
  }
  const outcome = await createInvoice({ id: invoiceId, ...body })
  switch (outcome.status) {
    case 'no-service':
      return problem(c, 404, 'No such service on the price list')
    case 'taken':
      return problem(c, 409, "The invoice id is another visit's invoice, or the line id another invoice's line")
    case 'visit-invoiced':
      return problem(c, 409, 'The visit already has an invoice')
    case 'created':
    case 'existing':
      return answer(c, outcome.invoice)
  }
}

/** The answer to a line added: as a change, or the invoice as it stands for a retry. */
function lineAnswer(c: Context<Env>, outcome: LineOutcome) {
  switch (outcome.status) {
    case 'no-service':
      return problem(c, 404, 'No such service on the price list')
    case 'taken':
      return problem(c, 409, "The line id is another invoice's line")
    case 'existing':
      return answer(c, outcome.invoice)
    default:
      return changed(c, outcome)
  }
}

export const putLine: RouteHandler<typeof addLineRoute, Env> = async (c) => {
  const { invoiceId, lineId } = c.req.valid('param')
  const version = versionOfTag(c.req.valid('header')['if-match'])
  return lineAnswer(c, await addLine(invoiceId, version, { id: lineId, ...c.req.valid('json') }))
}

export const putQuantity: RouteHandler<typeof quantityRoute, Env> = async (c) => {
  const { invoiceId, lineId } = c.req.valid('param')
  const version = versionOfTag(c.req.valid('header')['if-match'])
  return changed(c, await setQuantity(invoiceId, version, lineId, c.req.valid('json').quantity))
}

export const postRemoveLine: RouteHandler<typeof removeLineRoute, Env> = async (c) => {
  const { invoiceId, lineId } = c.req.valid('param')
  return changed(c, await removeLine(invoiceId, versionOfTag(c.req.valid('header')['if-match']), lineId))
}

export const postIssue: RouteHandler<typeof issueRoute, Env> = async (c) => {
  const { invoiceId } = c.req.valid('param')
  return changed(c, await issueInvoice(invoiceId, versionOfTag(c.req.valid('header')['if-match'])))
}
