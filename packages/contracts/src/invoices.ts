import { z } from 'zod'
import { PracticeHeaders, PracticePath, VersionTag } from './practice.js'

/**
 * The price list and a visit's invoice (spec #18, "Visit and money behaviour": the invoice; stories 56 to 61; #25).
 * Money travels as integer minor units beside its currency (IN-4), never as a decimal: 2500 is 25,00 ₼, and only the
 * design system's money wrapper turns it into an amount on screen. The draft invoice is created with its first line
 * by a `PUT` on an id the client generates, so a retry changes nothing; every later change carries the invoice's
 * version in `If-Match` and is refused with 412 when another change came first (spec 0001, "API conventions").
 */

/** An amount in whole minor units (qəpik for AZN), signed where the field says so. */
export const MinorUnits = z.int()
export type MinorUnits = z.infer<typeof MinorUnits>

/** The currencies money is kept in; AZN alone for now (spec 0002, "Money"). */
export const Currency = z.enum(['AZN'])
export type Currency = z.infer<typeof Currency>

/** What a service is, for the price list's grouping. */
export const ServiceCategory = z.enum(['consultation', 'procedure', 'lab', 'grooming', 'boarding', 'other'])
export type ServiceCategory = z.infer<typeof ServiceCategory>

/** A name in the three languages the product ships in; at least one is there. */
export const Descriptions = z.object({
  az: z.string().nullable(),
  ru: z.string().nullable(),
  en: z.string().nullable(),
})
export type Descriptions = z.infer<typeof Descriptions>

/** GET /api/p/{practiceId}/services response: the active services of the price list. */
export const Services = z.object({
  services: z.array(
    z.object({
      id: z.uuid(),
      names: Descriptions,
      category: ServiceCategory,
      /** The price of one unit now. */
      priceMinor: MinorUnits.nonnegative(),
      currency: Currency,
    }),
  ),
})
export type Services = z.infer<typeof Services>

/** The path of an invoice: its id, a UUID v7 the client generates when it creates the draft. */
export const InvoicePath = PracticePath.extend({ invoiceId: z.uuidv7() })
export type InvoicePath = z.infer<typeof InvoicePath>

/** The path of a line of an invoice: its id, a UUID v7 the client generates when it adds the line. */
export const InvoiceLinePath = InvoicePath.extend({ lineId: z.uuidv7() })
export type InvoiceLinePath = z.infer<typeof InvoiceLinePath>

/** The headers of a change to an invoice: the practice's, and the invoice's version the change was made against. */
export const InvoiceChangeHeaders = PracticeHeaders.extend({
  /** The invoice's version as the person last read it, `"3"`: a change made against an older one answers 412. */
  'if-match': VersionTag,
})
export type InvoiceChangeHeaders = z.infer<typeof InvoiceChangeHeaders>

/** How many of a service a line charges: above zero and at most 9999. */
export const Quantity = z.number().positive().max(9999)
export type Quantity = z.infer<typeof Quantity>

/** PUT …/invoices/{invoiceId}/lines/{lineId} request: the service to add from the price list, and how many. */
export const NewLine = z.object({ serviceId: z.uuid(), quantity: Quantity })
export type NewLine = z.infer<typeof NewLine>

/**
 * PUT /api/p/{practiceId}/invoices/{invoiceId} request: the draft invoice of a visit with its first line. Billing
 * stores the visit, patient and client it is given (BL-2); the API checks they are the visit's.
 */
export const NewInvoice = z.object({
  visitId: z.uuid(),
  patientId: z.uuid(),
  clientId: z.uuid(),
  line: NewLine.extend({ id: z.uuidv7() }),
})
export type NewInvoice = z.infer<typeof NewInvoice>

/** PUT …/invoices/{invoiceId}/lines/{lineId}/quantity request. */
export const LineQuantity = z.object({ quantity: Quantity })
export type LineQuantity = z.infer<typeof LineQuantity>

/** draft while lines are added; issued once it has its number and its charge (frozen from then on). */
export const InvoiceStatus = z.enum(['draft', 'issued'])
export type InvoiceStatus = z.infer<typeof InvoiceStatus>

/**
 * An invoice as the visit page's card shows it, every change to it answering the same. Removed lines are left out;
 * the totals are worked out by the API from the lines (spec 0002, "Value sourcing": Issue an invoice).
 */
export const Invoice = z.object({
  id: z.uuid(),
  status: InvoiceStatus,
  /** What the next change sends back in `If-Match`. */
  version: z.number().int().positive(),
  /** Taken at issue, gapless per practice; null while a draft. */
  number: z.string().nullable(),
  /** UTC instant, shown in the practice's time zone. */
  issuedAt: z.iso.datetime().nullable(),
  visitId: z.uuid().nullable(),
  patientId: z.uuid().nullable(),
  clientId: z.uuid().nullable(),
  currency: Currency,
  lines: z.array(
    z.object({
      id: z.uuid(),
      serviceId: z.uuid().nullable(),
      /** The service's names when the line was added. */
      description: Descriptions,
      quantity: z.number().positive(),
      /** The price list's price per unit when the line was added. */
      unitPriceMinor: MinorUnits.nonnegative(),
      /** Quantity times the unit price, rounded half up to a minor unit. */
      totalMinor: MinorUnits.nonnegative(),
    }),
  ),
  /** Total: the lines' totals added up. */
  totalMinor: MinorUnits.nonnegative(),
  /** Paid: what payments allocated to it (#26; zero until then). */
  paidMinor: MinorUnits.nonnegative(),
  /** Balance due once issued: the total less what was paid. */
  remainderMinor: MinorUnits,
})
export type Invoice = z.infer<typeof Invoice>

/** GET /api/p/{practiceId}/visits/{visitId}/invoice response: the visit's invoice, or null before its first line. */
export const VisitInvoice = z.object({ invoice: Invoice.nullable() })
export type VisitInvoice = z.infer<typeof VisitInvoice>

/** A visit's invoice as Visits today shows it: none yet, a draft, or issued and unpaid (part paid and paid with #26). */
export const InvoiceState = z.enum(['none', 'draft', 'unpaid'])
export type InvoiceState = z.infer<typeof InvoiceState>
