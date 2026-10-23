# Modules

One folder per bounded context in `docs/domain.md` §6, created by the slice that first needs it (the data model feature adds the schema skeleton for all thirteen). Modules reach each other only through their public interface or domain events, never through each other's tables; only `src/platform/` may import a database client (spec 0001, "Repository layout").

| Folder | Context |
|---|---|
| `clinical-record/` | Clinical Record |
| `hospitalization/` | Hospitalization |
| `prescription-dispensing/` | Prescription & Dispensing |
| `client/` | Client |
| `patient/` | Patient |
| `scheduling/` | Scheduling & Resources |
| `diagnostics/` | Diagnostics |
| `inventory/` | Inventory |
| `billing/` | Billing & Payments |
| `non-clinical-services/` | Non-Clinical Services |
| `preventive-care/` | Preventive Care |
| `client-communication/` | Client Communication |
| `identity-access/` | Identity & Access |

Each folder holds `schema.ts`, the context's Drizzle tables (empty until its slice arrives, its comment naming the tables spec 0002 assigns it), and `index.ts`, the module's public interface and the only file another module may import. `src/platform/db/practice-schema.ts` gathers every `schema.ts` for drizzle-kit and for `db()`; `schema.test.ts` beside it checks that none is left out.

## How a slice adds its tables

1. Declare the table in the module's `schema.ts`, where the spec's data model sketch assigns it: without a schema, spreading `standardColumns()` and typing money and languages with the `customType`s from `src/platform/db/platform-tables.ts` and `domains.ts` (every export there is `@public`, which is what lets a module import it). `.references()` only to the module's own tables and the platform tables; another module's table is a plain `uuid` column, the migration carries the `REFERENCES`, so the database enforces the key and the lint rule keeps the boundary. Exports must not clash with another module's: the gathering file re-exports them all by name.
2. Register its class in `src/platform/db/table-classes.ts` in the same commit (a view in `views`, a function the practice role calls in `functions`); the grants pass refuses the schema otherwise.
3. `pnpm --filter @vetora/api db:generate:practice --name <name>`, then finish the SQL by hand after `--> statement-breakpoint` lines: the two shared triggers on the new table, `set_updated_at` (BEFORE INSERT OR UPDATE) and `audit_row` (AFTER INSERT OR UPDATE OR DELETE), and every function, trigger, or constraint drizzle-kit does not model.
4. `pnpm test`: `schema.test.ts` fails until the migrated schema carries every declared column with its type and nullability, `grants.test.ts` and the migrate command refuse a table without its class or its triggers. The new table appears in `db().query` and in the parity test by itself. `pnpm --filter @vetora/api db:check` keeps the migration folder in order with what has landed (ADR 0002).
