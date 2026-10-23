/**
 * The Identity & Access tables: none of its own in a practice schema. `staff_member` and `audit_event` are platform
 * tables in src/platform/db/platform-tables.ts (the staff mirror because nearly every table references it, the audit
 * log because every table writes it), and the sign in tables land in the `control` schema with slice 1 (Better Auth;
 * src/platform/db/control-schema.ts). A table this context does come to own goes here (src/modules/README.md says how).
 */
export {}
