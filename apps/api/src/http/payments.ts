import { createRoute, type RouteHandler } from '@hono/zod-openapi'
import { InvoiceChangeHeaders, NewPayment, PaymentPath, versionOfTag } from '@vetora/contracts'
import { takePayment } from '../modules/billing/index.js'
import { problem } from '../platform/problem.js'
import type { Env } from './env.js'
import { answer, invoiceContent } from './invoices.js'
import { practiceRoute, refusals } from './practice-context.js'

/**
 * Take payment (#26; spec #18, "Visit and money behaviour": Take payment; stories 62 to 67), behind the request
 * context with the action whoever invoices performs (a receptionist, an assistant, a vet, the manager). One request,
 * one transaction: a draft invoice issued, then the payment, its ledger entry and its allocation. The payment carries
 * its UUID v7, so a retry changes nothing, and the invoice's version in `If-Match`. An amount of zero is the
 * validation's 400; one above what is still owed answers 409 naming the field, and the deferred allocation check
 * refuses it underneath whatever this route does (409 naming `vetora.incomplete_allocation`, through the request
 * context).
 */

export const takePaymentRoute = createRoute({
  method: 'put',
  path: '/api/p/{practiceId}/invoices/{invoiceId}/payments/{paymentId}',
  middleware: [practiceRoute('invoiceAndTakePayment')],
  summary: 'Take payment',
  description:
    "Takes a payment for the invoice against its version in If-Match, in one transaction: the invoice issued first when it is a draft, then the payment (now, at the request's location, received by the actor), the client's ledger entry and its allocation to the invoice. Partial by default: any amount above zero up to what is still owed. The payment id is a UUID v7 the client generates: the same request again changes nothing.",
  request: {
    params: PaymentPath,
    headers: InvoiceChangeHeaders,
    body: { content: { 'application/json': { schema: NewPayment } }, required: true },
  },
  responses: {
    200: { description: 'Taken: the invoice as it now stands', ...invoiceContent },
    404: { description: 'No such invoice, or a discarded one (problem details)' },
    409: {
      description:
        "The amount is above what is still owed (problem details naming `amountMinor` in `errors`), the payment id is another invoice's payment, or a rule of the record refused it (problem details naming the rule)",
    },
    412: { description: 'Another change came first: the version is stale (problem details)' },
    ...refusals,
  },
})

export const putPayment: RouteHandler<typeof takePaymentRoute, Env> = async (c) => {
  const { invoiceId, paymentId } = c.req.valid('param')
  const { amountMinor, method } = c.req.valid('json')
  const outcome = await takePayment({
    invoiceId,
    version: versionOfTag(c.req.valid('header')['if-match']),
    payment: { id: paymentId, amountMinor: BigInt(amountMinor), method },
  })
  switch (outcome.status) {
    case 'missing':
      return problem(c, 404, 'No such invoice')
    case 'stale':
      return problem(c, 412, 'The invoice changed since it was read')
    case 'taken':
      return problem(c, 409, "The payment id is another invoice's payment")
    case 'above-remainder':
      return problem(c, 409, 'More than is still owed on the invoice', {
        errors: [{ path: ['amountMinor'], code: 'above_remainder', message: 'At most what is still owed' }],
      })
    case 'paid':
    case 'existing':
      return answer(c, outcome.invoice)
  }
}
