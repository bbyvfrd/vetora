/**
 * The Billing & Payments tables (spec 0002, "Data model sketch": Billing and Payments): `invoice`, `invoice_line`,
 * `ledger_entry`, `payment`, `payment_allocation` (slice 1), `fiscal_receipt`, `cash_day_close` (slice 3), `estimate`,
 * `estimate_line`, `estimate_approval` (slice 8), with the `client_balance` view, `invoice_number_seq`, and
 * `next_invoice_number()`. None declared yet: the slice that builds a table adds it here (src/modules/README.md says how).
 */
export {}
