# 0002. Data model for vetora: rationale

Decision record for [index.md](index.md). `/develop` does not read this file.

## Context

vetora is practice management software for companion animal clinics in Azerbaijan, built by one developer around one pilot clinic. `docs/domain.md` defines thirteen bounded contexts and 36 numbered rules, and the scope calls the data model the costliest thing to redo: every slice from the first visit to boarding writes into it, and the legal and money rules (an immutable clinical record, dispensing tied to stock, debt as a ledger) must hold in the data itself, not only in screens. Spec 0001 already fixed the surroundings: PostgreSQL 18, Drizzle ORM 1.0 (release candidate) with `node-postgres`, one database per country with a `control` schema plus one schema per practice, database roles, forward only migrations applied per schema, and a request context that sets the practice schema and the acting person per transaction.

The forces that shaped this spec: the record must survive disputes and inspections years later (append only, attributable, retained); clinical decisions and stock movements are one transaction seen from two sides; a single developer cannot police invariants by code review alone, so the database must refuse wrong writes; the pilot runs in Russian and Azerbaijani with English for the developer, on Baku time, in manat; and every table must be location aware from day one without a second location existing. Several legal questions (controlled drug register, fiscal receipts, record retention) are still open, so the model carries the stricter interim answer wherever relaxing later is cheap and retrofitting is not.

Not deciding would mean each slice inventing its own tables and rules, with the append only guarantees and the money ledger retrofitted after real clinic data exists.

## Options considered

### Option 1: Normalised tables per bounded context, rules enforced in Postgres

One table per domain concept (singular names from the glossary), shared conventions (UUID v7, actor and audit columns, `occurred_at` beside `created_at`), and the §8 invariants expressed as constraints, triggers, deferred checks, and grants: append only classes, exclusion constraints for ownership and bookings, a commit time check that every dispense has its movement and charge, a view for client balance, a role per practice.

**Pros**:
- The guarantees hold regardless of application bugs, and each is provable with one query.
- Fits Drizzle and SQL first tooling; every slice adds tables, none reshapes them.
- Audit and attribution are automatic for every table.

**Cons**:
- More database objects (triggers, domains, owner run functions, a grants pass, roles) to write, test, and keep in order across slices.
- Commit time failures must be handled as first class errors in the handlers.

### Option 2: A document shaped model (JSON notes, wide visit rows, balances stored)

Fewer tables: a visit row with a JSON note and JSON lines, products with a quantity column, a stored client balance, and application code enforcing the rules.

**Pros**:
- Fastest to start and to change while the clinic's workflow is still being learned.
- Fewer joins on the busiest screens.

**Cons**:
- Immutability, one owner at a time, no double booking, and a trustworthy balance all rest on code discipline; a single missed path breaks a legal or money guarantee silently.
- Dose derivations, lot level dispensing, and the audit trail do not fit documents; they get bolted on later, which is the retrofit the scope warns against.

### Option 3: Event sourced core (every change an event, state projected)

Store immutable events per aggregate (encounter, admission, invoice) and project current state into read tables.

**Pros**:
- The strongest audit story: the history is the data.
- Amendments, reversals, and handovers fall out naturally.

**Cons**:
- A heavy pattern for one developer: projections, replays, versioned events, and tooling Drizzle does not provide.
- Most of the benefit (append only records, audit rows, reversing entries) is available in Option 1 with ordinary tables.

## Rationale

Option 1 answers the forces directly. The rules that matter most (CR-1, RX-3, BL-6, PT-1, RS-1, IN-1) are exactly the ones a relational database expresses well: role grants and triggers for append only, an exclusion constraint for overlap, a deferred check that a dispense committed with its movement and charge, a view for the balance. With one developer, enforcement in the database is worth more than flexibility in the schema, and Postgres with Drizzle's SQL first tooling (spec 0001) makes the hand written parts (triggers, domains, exclusion constraints) first class rather than exceptions. The design keeps the merge signals from domain.md §6.6 open: Client and Patient stay separate tables, boarding stays outside the clinical record, and either can change without a breaking migration.

Option 2 would be quicker for the first slice and slower for every slice after it, and it would put the clinic's legal and money guarantees into code paths nobody can audit. Option 3 solves problems the clinic does not have at the cost of a pattern the team cannot operate at 2am. Where the engineer could have chosen a lighter route (app level rules, a quantity column, a stored balance, one shared app role), they chose the database each time, consistent with the scope's GA tier for this feature.

### Smaller calls made in this spec (pick, why, runner up)

- **Handlers write every row; deferred constraint triggers verify at commit** (changed after the cross check): nothing is written invisibly, TypeScript stays testable, and RX-3 and BL-6 still cannot be broken because the transaction fails without its companion rows; runner up triggers that write the movement and ledger rows behind each insert (guaranteed on every path, but handlers must read back what the trigger filled, which produced three of the cross check's gaps).
- **A role per practice switched per transaction** (changed after the cross check): a schema qualified query on another practice fails with permission denied, so isolation no longer rests only on the request context never qualifying a name; runner up one app role with grants on every schema and the two practice test as the guard.
- **Owner run functions for the audit log and the drug register**: the practice role can request a register entry but cannot forge or edit one; runner up plain INSERT grants.
- **Cached `lot.quantity_on_hand`** kept by the movement trigger with a check and a column grant: stock screens read one column, the ledger stays the truth, nothing else can touch it; runner up summing movements on every read.
- **Materialised `treatment_due` rows with the outcome on `administration` only**: a missed dose is a fact a person recorded at handover (HS-2), and overdue is derived; runner up a status column on the due row (two sources of truth, and nobody to write "missed").
- **Audit by one generic row trigger into one table**, storing new values only: nothing can forget to log and the table stays half the size; runner up a history table per table.
- **Migrations may write audit rows with no actor** (`source = migration:<name>`, keyed on the session user): seed and data migrations are reviewed code, not anonymous actors; runner up a fake system staff member (IN-1 forbids it).
- **Three name columns per catalog row** (`name_az`, `name_ru`, `name_en`) with ICU collations, and three description snapshots per invoice line: typed, indexable, sortable, printable in the client's language; runner up a JSON names column.
- **`date` for calendar facts** (ownership periods, boarding nights, birth dates, due dates, business dates) and `timestamptz` for instants: avoids time zone drift on things that are not instants; runner up timestamps everywhere.
- **Set once columns as a class** (`valid_to`, `withdrawn_at`, `acknowledged_at`, `removed_at`, `cancelled_at`): one UPDATE from null is allowed and audited, nothing else; runner up a second row per change.
- **No DELETE grant anywhere**, with the one delete path (an import revert) run by the migrator before go live and audited: IN-6 cannot be broken by a helper; runner up DELETE on draft tables only.
- **Reference rows seeded by data migrations** (species, default appointment types) and practice specific rows by provisioning (settings, default location, first manager): existing practices receive new reference rows, and each practice may edit its own; runner up shared reference tables in `control`.
- **`occurred_at` beside `created_at`** with a back dating window from settings and a `business_date` for money: honest timestamps for a rushed ward and a day close that cannot be back filled; runner up the clock only.
- **A receipt per payment** rather than per invoice: the cash register issues a receipt when money is taken, a payment may settle several invoices, and a correction references the old receipt; runner up a receipt column on the invoice (the scope's interim wording).
- **Stock unit on the product** with every quantity, price, and cost per stock unit: a partial pack is a number, not a guess; runner up quantities in packs.
- **Dose defaults per product and species** (`product_species_dose`) with the maximum as a warning: the vet's input has a source and the ceiling is visible, never silently applied; runner up free numbers typed each time.
- **Administrations in slice 2 with an encounter or a due row**: an injection in the consult room charges and moves stock the same way as a ward dose; runner up administrations only on the ward (slice 8), leaving consult room injections with no path.
- **Duplicate phones warned, not blocked**: families and shelters share numbers; runner up a unique index.
- **Grooming without a table of its own** beyond an optional note: it is an appointment plus services; runner up a `grooming_service` table mirroring boarding.
- **A stock transfer as its own row with two movements** (added 2026-10-22): the destination lot is the same series at the other stock location, so the controlled drug balance per location stays honest; runner up an adjustment pair with a reason, which hides the link between the two halves.
- **A discount as a column beside the price list snapshot** (added 2026-10-22): both prices survive and nobody edits a price or the price list to give one; runner up a negative line, which makes totals and reports count a discount as an item.
- **Patient alerts as their own table** (added 2026-10-22): a handling warning is not a clinical problem and must not resolve with one; runner up a flag on `patient_problem`.
- **An optional due date on the invoice** (added 2026-10-22): overdue is derived from it and a cash client never has one; runner up payment terms per client, which no walk in client needs.

### What the doc check established (2026-10-22)

From `docs/research/2026-10-22-scaffold-doc-check.md`: Drizzle 1.0 is at release candidate 5 (npm `latest` is 0.45.4); its migrator runs every pending migration in one transaction, migration SQL follows the connection's `search_path` so one practice folder applies to many schemas, and `migrationsSchema` must be set per target schema or every schema shares one migrations table. These shape the `migrate` command in the build plan. DigitalOcean offers Postgres 18 in `fra1` with `btree_gist`, `pg_trgm`, and `unaccent` available; `doadmin` can create roles (to be smoke tested), which the per practice roles rely on.

### Cross check (2026-10-22)

An independent read of the first draft on a different model (Claude Opus) found sixteen decision gaps and ten soundness findings, verdict "sound with the gaps closed". The engineer chose to apply every recommended fix and the two design changes it proposed (handlers write with deferred checks; a role per practice). The gaps closed: no writer created or lapsed the care relationship; a single staff role kept an owner who is also a vet from finalising; append only rows were being filled in later (reversed into forward references, and the receipt moved onto the payment); the charge on issue, the void reversal, counter sale and count movements had no named writer, and dispensed and retail lines shared a kind; administrations required a ward due row, so consult room injections and vaccines had no stock, charge, or register path; quantities had no unit; a dose cited a weight that could still change and dose per kg had no source; a sale to nobody could not be issued; drafts could not be discarded and imports could not be reverted; dispenses were not checked against the issued prescription, product, expiry, or quantity; due rows and administrations both held the outcome and discharge left orders running; the register lacked kinds, ran its balance across locations, and had no stable order; allocations had no caps, expected cash no source, closed days no lock, invoices no number, and lines one language; estimates stayed editable and consent was never required; admission bookings had no end and cancelled appointments kept theirs; forward columns were missing from the slice lists. The soundness fixes: extensions moved to a shared `ext` schema (the draft would have installed them inside the first practice schema), the audit and register tables made function written, the actor check made robust to an empty setting, child inserts locking their parent, a `valid_to > valid_from` check, provisioning registering first and idempotent per step, audit rows storing new values only with autosave every 30 seconds, and ICU collations on name columns.

### Grilling (2026-10-22)

A `/grill-with-docs` session on 2026-10-22 read this spec against `docs/domain.md` and the vetora design system glossary and settled nineteen term and boundary conflicts, recorded in domain.md's change log, `docs/adr/0001-administration-belongs-to-dispensing.md`, and `docs/research/2026-10-22-grilling-domain-terms.md`. The index was updated in place: the staff role values follow domain.md §3 (manager, assistant, receptionist), the ownership roles lose caretaker, the encounter carries the note's six sections with no `note_format`, the observation kind is `pulse`, `patient_alert` joins slice 1, a lot is a manufacturer series topped up by later deliveries with `stock_transfer` for moves between stock locations, the invoice gains `due_on` and its lines a discount beside the list price, `visit_summary` goes and a receipt document points at its payment, the boarding schedule names the owner's own medication, and a house call is a seeded appointment type. The acceptance criteria are unchanged in substance; AC-10's wording follows the role rename.

### Cross check of the update (2026-10-22)

A second read on another model (Claude Opus) found ten decision gaps and eight soundness findings in the in place update, verdict "sound with the gaps closed". The engineer applied every recommended fix, choosing two simpler shapes over the critique's: no loose end list for unissued discharge summaries yet (a slice 6 question), and a PIN unlock that never carries the manager role (spec 0001) instead of a TOTP step up at the first manager only action.

## References

**Project sources**:
- `docs/domain.md`: §1 three parties, §2 the practice day, §4 money, §5 what the law requires, §6 contexts and the context map, §8 invariants, §9 domain events, §10 cross cutting, §12 OPEN register
- `docs/specs/0001-stack-architecture/index.md` and its rationale: tenancy, roles, migrations, request context, the smaller calls on the driver and the typed client
- `docs/scope/scope.md`: feature 3 and the slices 1 to 10 whose entities this spec covers
- The vetora design system (Claude Design System artifact, linked from spec 0001): appointment states, calendar categories, print documents, languages
- `docs/research/2026-10-22-scaffold-doc-check.md`: Drizzle and DigitalOcean facts above
- `docs/adr/0001-administration-belongs-to-dispensing.md` and `docs/research/2026-10-22-grilling-domain-terms.md`: the 2026-10-22 decisions applied in place

**Practices & standards**:
- Domain driven design: aggregates, bounded contexts, ubiquitous language (the method behind domain.md)
- Append only ledgers and audit trails for money and legal records
- Least privilege database roles; grants derived from a table classification; a role per tenant
- Deferred constraint triggers for transactional invariants; owner run functions for rows the application must not forge
- Exclusion constraints for scheduling and temporal relationships
- Derivations stored with their inputs; snapshot pricing; derived balances at read time
- Expand then contract, forward only migrations applied per schema under a lock
- Monolith first with modules that own their tables
