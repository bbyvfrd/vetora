import { z } from 'zod'
import { InvoicePath, MinorUnits } from './invoices.js'

/**
 * Take payment (spec #18, "Visit and money behaviour": Take payment; stories 62 to 67; #26): a payment against a
 * visit's invoice, which issues it first when it is a draft. The payment is created by a `PUT` on an id the client
 * generates, so a retry changes nothing, and carries the invoice's version in `If-Match` (`InvoiceChangeHeaders`), so a
 * payment is never taken for an invoice that changed since it was read. Its amount travels in whole minor units (IN-4):
 * the person types manat, and the web app turns it into qəpik.
 */

/** The path of a payment of an invoice: its id, a UUID v7 the client generates when the dialog opens. */
export const PaymentPath = InvoicePath.extend({ paymentId: z.uuidv7() })
export type PaymentPath = z.infer<typeof PaymentPath>

/** How the client paid at the desk; a bank transfer arrives with feature 8. */
export const PaymentMethod = z.enum(['cash', 'card'])
export type PaymentMethod = z.infer<typeof PaymentMethod>

/**
 * PUT /api/p/{practiceId}/invoices/{invoiceId}/payments/{paymentId} request: what was paid, and how. Above zero; the
 * API refuses an amount above what is still owed on the invoice.
 */
export const NewPayment = z.object({
  /** The amount in whole minor units: 2550 is 25,50 ₼. */
  amountMinor: MinorUnits.positive(),
  method: PaymentMethod,
})
export type NewPayment = z.infer<typeof NewPayment>
