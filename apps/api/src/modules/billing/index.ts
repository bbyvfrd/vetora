/**
 * The public interface of the Billing & Payments module (spec 0001, "Repository layout"): a visit's invoice created
 * with its first line, its lines changed while a draft, issued with its number and the client's charge, and read; the
 * invoice state of each visit for Visits today; and the discard Cancel visit asks for (#25). Take payment, which issues
 * a draft and records the payment with its ledger entry and allocation, and a client's balance (#26). Every function
 * runs in the request's transaction.
 */
export {
  addLine,
  type CreateOutcome,
  createInvoice,
  discardVisitInvoice,
  type InvoiceChange,
  type InvoiceState,
  type InvoiceView,
  invoiceStates,
  issueInvoice,
  type LineOutcome,
  readInvoice,
  removeLine,
  setQuantity,
  visitInvoice,
} from './invoices.js'
export { type ClientBalance, clientBalance, type PaymentMethod, type PaymentOutcome, takePayment } from './payments.js'
