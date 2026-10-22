# 0002. Data model for vetora

**Date**: 2026-10-22
**Status**: Proposed

## Summary

This spec turns the thirteen bounded contexts and the numbered rules in `docs/domain.md` into the tables, keys, and constraints every slice of vetora builds on, inside the one schema per practice (clinic) that spec 0001 chose. The database itself enforces the hard rules: finalised records and money ledgers cannot be edited, a dispense cannot be saved without its stock movement and charge, bookings cannot overlap, every change names who made it, and a practice cannot read another practice's rows even by naming them. Application code writes every row in plain sight; the database refuses to commit a transaction that leaves a rule unmet. The build ships the shared foundations now (practice settings, locations, staff, the audit log, the shared triggers and functions, the migrate and provision commands), and each later slice adds its own context's tables from this design, so nothing sits unused and no slice needs a breaking change to an earlier table.

## Requirements

**User stories**:
- As the developer, I want every table a planned slice needs designed once, so that each slice adds tables without reshaping earlier ones.
- As a practice owner, I want the clinic's legal and money records to be impossible to edit or delete by mistake, so that the record stands up to a dispute or an inspection.
- As a veterinarian, I want doses, weights, and dispensing tied to the facts they were based on, so that a later correction never rewrites what happened.
- As reception, I want double bookings and silent debt drift to be impossible, so that the schedule and the till can be trusted.
- As the operator, I want each clinic's data in its own schema behind its own database role, with one command to set a clinic up and one to migrate every clinic, so that a clinic can be exported or restored on its own and never leak into another.

**Acceptance criteria** (the contract; each one is checkable on a real database):
- **AC-1**: Every entity the scope names for slices 1 to 10 has a table in the data model sketch below, and each later slice adds its tables as new tables and nullable references only, never by changing an earlier table's keys or dropping its columns (no breaking migration). The forward columns each slice adds are listed under that slice in the build plan.
- **AC-2**: Once `finalised_at` is set, any UPDATE or DELETE on an `encounter` row, its diagnoses, or its observations through the practice role is rejected by the database; a correction is an `encounter_amendment` row (CR-1).
- **AC-3**: A `dispense_event` cannot be saved without a `lot` (whose expiry is required, is not past, and holds the prescribed product), and a transaction that inserts a dispense without also inserting its `stock_movement`, its `invoice_line`, and, for a controlled product, its `controlled_drug_entry` cannot commit; the lot's `quantity_on_hand` drops by the quantity, and never below zero (RX-1, RX-2, RX-3).
- **AC-4**: A client's balance is the sum of that client's `ledger_entry` rows, read through the `client_balance` view; no table stores a balance, and ledger rows cannot be updated or deleted (BL-6).
- **AC-5**: Two `ownership` rows with role owner whose periods overlap for one patient are rejected; closing one and opening another keeps both rows (PT-1).
- **AC-6**: Weight is a `clinical_observation` row that can never change; a `dose_calculation` references the weight observation it used and snapshots its value; inserting a corrected weight leaves existing dose calculations unchanged (PT-2, RX-5).
- **AC-7**: Two active `resource_booking` rows for one resource with overlapping periods are rejected; cancelling a booking (a status change, never a delete) frees the slot (RS-1).
- **AC-8**: Every insert and update on a practice table writes an `audit_event` row naming the acting staff member from `app.actor_id`; a write through the practice role with the actor unset or empty is rejected (IN-1).
- **AC-9**: Money columns are integer minor units beside a currency column that accepts `AZN` (IN-4); every location scoped table carries `location_id` (IN-5); the practice role has no DELETE on any table and only INSERT and SELECT on append only tables (IN-6).
- **AC-10**: `migrate` applies pending control migrations, then pending practice migrations to every registered practice schema in registry order, under one advisory lock, then runs the grants pass, and exits non zero if any schema fails; `provision-practice` registers a practice, creates its role and schema, applies the practice set, grants, seeds its settings, default location, and first owner, and marks it active; running it again for the same slug changes nothing.
- **AC-11**: The app role cannot read any practice table, even by its schema qualified name, until it switches to that practice's role; after `SET LOCAL ROLE` for practice A, a qualified query on practice B fails with permission denied.
- **AC-12**: `controlled_drug_entry` rows are written only through the register function, cannot be updated or deleted, and each one references exactly one stock movement; a transaction that moves a controlled product without registering it cannot commit (RX-4).
- **AC-13**: Language columns accept only `az`, `ru`, and `en`; `occurred_at` values cannot lie in the future; both are check constraints.
- **AC-14**: An encounter cannot be finalised, and a prescription cannot be issued, unless the patient has a care relationship row current at that moment for that veterinarian (or any veterinarian of the practice when delegation is on); the finalising or issuing transaction creates or renews that row (CR-4).

## Decision

**Chosen option**: Option 1: normalised tables per bounded context, with the domain rules enforced in Postgres

One practice schema holds one set of normalised tables per bounded context (singular `snake_case` names, UUID v7 keys, shared audit and actor columns), accessed through a database role per practice, and the rules in `docs/domain.md` §8 are enforced by constraints, deferred constraint triggers that check each transaction at commit, and role grants, with application handlers writing every row explicitly.

## Rationale

Reasoning, the options weighed, the smaller calls, and the cross check: see [rationale.md](rationale.md).

## Feature design

### Conventions shared by every table

- **Schemas**: `control` holds the practice registry (and the sign in tables from slice 1). `ext` holds the extensions (`btree_gist`, `pg_trgm`, `unaccent` and its immutable wrapper), created once by the control set so every practice sees one copy. Each practice owns `p_<practiceId>` with every table below. Nothing practice specific lives in `public`.
- **Roles**: `vetora_migrator` owns every schema, table, and function. Each practice has a no login role `p_<practiceId>_role` holding that schema's grants; `vetora_app` is a member of each practice role without inheriting and with the right to set it. A request transaction runs `SET LOCAL ROLE p_<id>_role`, `SET LOCAL search_path = p_<id>, ext`, and `set_config('app.actor_id', <staff id>, true)` (spec 0001's request context, slice 1). Outside that, `vetora_app` holds no grant on any practice table. `vetora_backup` reads everything for dumps.
- **Who writes**: application handlers insert and update every business row in one transaction, in plain sight. The database writes only what must never be wrong by construction: `updated_at` and `updated_by`, the audit log, the cached lot balance, and sequence numbers. Deferred constraint triggers (checks that run when the transaction commits) refuse a transaction that leaves a rule unmet, so a handler cannot forget a row without the whole transaction failing.
- **Keys**: `id uuid` with default `uuidv7()` (Postgres 18, time ordered); the API may supply the id on create (spec 0001, safe retries). Foreign keys are indexed. Keys and columns are never dropped or retyped once a slice ships (AC-1). Ids that mirror sign in ids (`staff_member.id`, `control.practice.id`) are UUIDs issued by the sign in library configured to produce UUID v7 (first visit spec).
- **Standard columns** on every practice table: `created_at timestamptz`, `created_by uuid` (staff member), `updated_at timestamptz` and `updated_by uuid` kept by a trigger, `version int` on mutable tables (optimistic concurrency, rejected with 412 per spec 0001). Location scoped tables (marked `loc` below) carry `location_id → location`.
- **Actor**: the trigger reads `nullif(current_setting('app.actor_id', true), '')`; a null or empty value raises `vetora.no_actor` unless `session_user` is `vetora_migrator` (a migration or an import revert), in which case the audit row records `source = migration:<name>` with no actor. `created_by` and `updated_by` come from the setting, never from a request body.
- **Time**: instants are `timestamptz` in UTC, shown in the practice's time zone. Event tables carry `occurred_at` (what the staff member says happened, editable only while the parent record is a draft, never in the future, back datable within `practice_settings.backdate_limit_hours`) beside `created_at` (the database clock, never editable). Calendar facts (birth date, ownership periods, boarding nights, business dates) are `date`; a `business_date` is derived by the handler from `occurred_at` in the practice time zone.
- **Money**: a domain `minor_units` (bigint) beside a `currency` column of domain `currency_code` (check: `AZN` for now). Totals are computed from lines at read time; invoice lines snapshot names and prices.
- **Quantities**: every stock quantity (lot balance, movement, dispense, sale line, administration, minimum stock) and every price or cost per unit is in the product's `stock_unit` (ml, tablet, piece, gram); `pack_size` is stock units per pack received.
- **Languages**: a domain `lang_code` with check `az`, `ru`, `en`. Catalog names carry `name_az`, `name_ru`, `name_en` (at least one required) with ICU collations `az-x-icu`, `ru-x-icu`, `en-x-icu`; person and patient names sort with the practice default language's collation in queries. Free clinical text has no language column: it may mix languages.
- **Value sets**: state machines and fixed kinds are text columns with check constraints (listed per table). Sets the clinic edits (species, breeds, appointment types, services, products, lab tests, protocols) are tables with an `active` flag; nothing is ever deleted.
- **Table classes** (enforced by the grants pass and triggers):
  - *append only*: INSERT and SELECT only for the practice role; no UPDATE, no DELETE.
  - *set once*: like append only, plus one UPDATE that fills named columns from null (for example `withdrawn_at`, `acknowledged_at`, `removed_at`); a trigger rejects any other change.
  - *mutable*: INSERT, UPDATE, SELECT; never DELETE. Records retire by status.
  - *frozen by status*: mutable until a status column reaches its final value, then a trigger rejects every change to the row and its child rows except the columns the table names; a child row insert locks its parent (`FOR SHARE`), so a child cannot slip in beside a concurrent freeze.
  - *function written*: `audit_event` and `controlled_drug_entry` are SELECT only for the practice role; their rows come from functions owned by `vetora_migrator` that run as the owner with a pinned `search_path`.
- **Naming**: `snake_case`, singular table names from the domain.md glossary, booleans `is_` or `has_`, timestamps `_at`, dates `_on`, foreign keys `<table>_id`.

### Data model sketch

Legend: `?` nullable, `→` foreign key, `!` unique, `[class]` table class, `loc` location scoped. Standard columns are omitted from every row. A reference that points at a table shipping in a later slice is added by that slice as a nullable column (listed in the build plan).

**Control schema `control`**

| Table | Columns | Keys and rules |
|---|---|---|
| `practice` [mutable] | `id` (equals the sign in organisation id from slice 1), `slug text !`, `name`, `schema_name text !`, `role_name text !`, `status` provisioning, active, suspended, archived | The registry only: routing and status. Inserted first by provisioning; deleting is disabled. |

**Platform and settings (practice schema)**

| Table | Columns | Keys and rules |
|---|---|---|
| `practice_settings` [mutable] | `legal_name`, `display_name`, `address?`, `phone?`, `tax_id?`, `time_zone` (default `Asia/Baku`), `currency` (AZN), `languages lang_code[]` (default az, ru), `default_language`, `letterhead_file_id? → file` (slice 6), `care_relationship_lapse_months int` (12), `backdate_limit_hours int` (24), `delegation_enabled bool` (true), `go_live_at timestamptz?` (set once) | Exactly one row: a check on a constant `id`. Seeded by provisioning from its arguments. |
| `location` [mutable] | `name`, `address?`, `phone?`, `is_default bool`, `active bool` | One default per practice (partial unique index). Provisioning seeds the default location. |
| `staff_member` [mutable] | `id` (equals the control user id, not generated), `display_name`, `roles text[]` (subset of owner, veterinarian, feldsher, administrator, groomer; at least one), `active bool`, `synced_at` | Mirror of the control membership, synced idempotently (spec 0001). The first owner's row is written by provisioning as that owner. |
| `audit_event` [function written] | `table_name`, `row_id uuid`, `action` insert, update, delete, `actor_id? → staff_member`, `source text` (`request` or `migration:<name>`), `occurred_at` (database clock), `changed jsonb` (the new values of the columns that changed; an insert stores the row), `request_id?` | Check: `actor_id` is null only when `source` starts with `migration:`. Indexes on (`table_name`, `row_id`) and (`actor_id`, `occurred_at`). Written by `audit_row()`. |
| `import_batch` [mutable] (slice 7) | `kind` clients_pets, debts, `file_id? → file`, `status` preview, applied, reverted, `summary jsonb?`, `applied_at?`, `applied_by?`, `reverted_at?`, `reverted_by?` | Rows created by an import carry `import_batch_id` (client, patient, ownership, ledger_entry). A revert is run by `vetora_migrator`, deletes those rows, is audited as `delete`, and is allowed only while `practice_settings.go_live_at` is null. |

**Client**

| Table | Columns | Keys and rules |
|---|---|---|
| `client` [mutable] | `kind` person, organisation, `first_name?`, `last_name?`, `patronymic?`, `organisation_name?`, `tax_id?`, `contact_person?`, `preferred_language lang_code`, `notes?`, `status` active, archived, `import_batch_id?` | Check: a person has `last_name`, an organisation has `organisation_name`. No balance column (BL-6). |
| `client_contact` [mutable] | `client_id →`, `kind` phone, whatsapp, telegram, email, `value`, `value_normalised` (E.164 for phone kinds, lower case for email), `label?`, `is_primary bool`, `messaging_allowed bool` | Index on `value_normalised` (duplicates are warned about, never blocked). One primary per client (partial unique). |
| `consent_record` [set once] (slice 8) | `patient_id →`, `client_id →`, `ownership_id? → ownership`, `granter_name`, `granter_authority` owner, authorised_person, other, `scope` surgery, anaesthesia, euthanasia, procedure, boarding, data_processing, `text_version`, `granted_at`, `withdrawn_at?` (set once), `form_file_id? → file`, `encounter_id?`, `admission_id?`, `estimate_id?` | Consent is an object (IN-2): three consents to one procedure are three rows. A service whose `requires_consent_scope` is set needs a current consent of that scope for the patient before its invoice line is issued (deferred check). |

**Patient (shared kernel with Client: `ownership`)**

| Table | Columns | Keys and rules |
|---|---|---|
| `species` [mutable, seeded] | `code !`, `name_az`, `name_ru`, `name_en`, `clinically_supported bool`, `sort int` | Seeded by a slice 1 data migration with dog, cat (supported) and rabbit, bird, reptile, rodent, other (recorded only; OPEN-11). |
| `breed` [mutable] | `species_id →`, `name_az?`, `name_ru?`, `name_en?`, `active bool` | At least one name; unique (`species_id`, `name_ru`) where present. The clinic adds breeds. |
| `patient` [mutable] | `name`, `species_id →`, `breed_id? →`, `sex` male, female, unknown, `is_neutered bool`, `neutered_on date?`, `birth_date date?`, `birth_date_is_estimate bool`, `colour?`, `markings?`, `microchip_number?`, `passport_number?`, `photo_file_id? → file` (slice 6), `life_status` alive, deceased, `deceased_on date?`, `status` active, archived, `notes?`, `import_batch_id?` | Partial unique on `microchip_number` where not null. Death is a status (PT-4). |
| `ownership` [set once] | `patient_id →`, `client_id →`, `role` owner, authorised_person, caretaker, `valid_from date`, `valid_to date?` (set once), `note?`, `import_batch_id?` | Check `valid_to > valid_from`. Exclusion constraint (`btree_gist`): `patient_id` equal and `daterange(valid_from, valid_to)` overlapping, where `role = 'owner'` (a null `valid_to` is open ended), so one current owner per patient (PT-1). |
| `patient_problem` [mutable] | `patient_id →`, `title`, `status` active, resolved, `opened_at`, `resolved_at?`, `opened_in_encounter_id? →`, `resolved_in_encounter_id? →`, `note?` | The problem list belongs to the patient (CR-6). |

**Clinical Record**

| Table | Columns | Keys and rules |
|---|---|---|
| `care_relationship` [set once] | `patient_id →`, `veterinarian_id → staff_member`, `established_at`, `established_by_encounter_id? →`, `lapses_at`, `ended_at?` (set once), `ended_by? →` (set once) | Partial unique (`patient_id`, `veterinarian_id`) where `ended_at` is null. Current means `ended_at` is null and `lapses_at > now()`. The handler that finalises an encounter or issues a prescription inserts one when none is current, else extends `lapses_at` (a set once exception: `lapses_at` may only move later); `lapses_at` = that moment plus `practice_settings.care_relationship_lapse_months`. |
| `encounter` [frozen by status] loc | `patient_id →`, `client_id →` (the responsible client at the time), `veterinarian_id → staff_member`, `care_relationship_id? →`, `appointment_id? →` (slice 5), `arrival_id? →` (slice 5), `admission_id? →` (slice 8), `status` draft, finalised, discarded, `started_at`, `ended_at?`, `note_format` ru_tradition, soap, `anamnesis?`, `anamnesis_reported_by?` (who told it, CR-5), `status_praesens?`, `diagnosis_text?`, `plan?`, `finalised_at?`, `finalised_by? → staff_member` | Finalise trigger: `finalised_by` has role veterinarian (CR-2); `care_relationship_id` is set and current at `finalised_at` for that vet or, with delegation on, any vet (CR-4, AC-14); the row and its diagnoses and observations freeze (CR-1). Discard is rejected while any prescription, dispense, or administration references the encounter. An encounter that is the admitting encounter of an admission never carries `admission_id`. Drafts autosave into the same row, at most every 30 seconds. |
| `encounter_diagnosis` [frozen with encounter] | `encounter_id →`, `text`, `code?`, `kind` working, definitive, `patient_problem_id? →` | |
| `encounter_amendment` [append only] | `encounter_id →`, `section` anamnesis, status_praesens, diagnosis, plan, other, `prior_text?`, `new_text`, `reason`, `author_id → staff_member` | Only allowed when the encounter is finalised. |
| `clinical_observation` [append only] loc | `patient_id →`, `encounter_id? →`, `admission_id? →` (slice 8), `kind` weight, temperature, heart_rate, respiratory_rate, body_condition, other, `value numeric(10,3)`, `unit`, `occurred_at`, `measured_by → staff_member`, `note?` | Value, unit, time, and measurer are all required (CR-3); a weight is in `kg`. A weight with no encounter is allowed (taken at reception). A correction is a new row. |

**Prescription, Dispensing, and Administration (slice 2)**

| Table | Columns | Keys and rules |
|---|---|---|
| `prescription` [frozen by status] | `encounter_id →`, `patient_id →`, `prescriber_id → staff_member`, `care_relationship_id →`, `status` draft, issued, cancelled, `issued_at?`, `cancelled_at?`, `cancel_reason?`, `notes?` | Issue trigger: a current care relationship (AC-14) and a prescriber with role veterinarian. Frozen when issued; cancel is the one later change. |
| `prescription_line` [frozen with prescription] | `prescription_id →`, `product_id →`, `dose_amount numeric?`, `dose_unit?`, `route?`, `frequency?`, `duration_days int?`, `quantity numeric` (stock units), `instructions?`, `dispense_at_clinic bool`, `sort int` | |
| `product_species_dose` [mutable] | `product_id →`, `species_id →`, `route?`, `default_dose_per_kg numeric`, `max_dose_per_kg numeric?`, `dose_unit`, `note?` | Unique (`product_id`, `species_id`, `route`). Feeds the dose calculator's default; the maximum is a warning in the app, never silently applied (PT-3). |
| `dose_calculation` [append only] | `prescription_line_id →`, `weight_observation_id → clinical_observation`, `weight_kg numeric(6,3)` (snapshot), `species_id →`, `concentration numeric`, `concentration_unit`, `dose_per_kg numeric`, `dose_unit`, `result_amount numeric`, `result_unit`, `calculated_by →` | Trigger: the observation is a weight of the same patient and `weight_kg` equals its value. A dose is a derivation that keeps its inputs (RX-5, PT-2); the newest row for a line is the one in force. |
| `dispense_event` [append only] loc | `prescription_line_id →`, `lot_id →`, `quantity numeric`, `occurred_at`, `dispensed_by →`, `instructions_printed?` | Insert trigger: the prescription is issued, `lot.product_id` equals the line's product, the lot is active and `expiry_on` is today or later, and the line's dispensed total stays within its `quantity`. Deferred check at commit: exactly one `stock_movement` (kind dispense) and one `invoice_line` (kind dispense) reference it, and a `controlled_drug_entry` references that movement when the product is controlled (RX-3, RX-4). A mistake is a return movement plus a new dispense. |
| `administration` [append only] loc | `encounter_id? →`, `treatment_due_id? →` (slice 8), `product_id? →`, `service_id? →`, `lot_id? →`, `quantity numeric?`, `route?`, `status` given, refused, missed, `occurred_at`, `performed_by →`, `note?` | Check: exactly one of `encounter_id`, `treatment_due_id`; one administration per due row (partial unique). Given with a stock tracked product requires `lot_id` and, at commit, one `stock_movement` (kind administration) and one `invoice_line` (kind administration) referencing it (HS-3, RX-3). Refused and missed are recorded by the person who establishes it (HS-2). |
| `controlled_drug_entry` [function written] loc | `entry_no bigint`, `kind` receipt, dispense, administration, return, adjustment, write_off, `product_id →`, `lot_id →`, `stock_movement_id → !`, `quantity_delta numeric`, `balance_after numeric`, `patient_id? →`, `encounter_id? →`, `signed_by → staff_member`, `occurred_at` | Written only by `record_controlled_entry(stock_movement_id, signed_by)`, which takes `entry_no` and `balance_after` per (`product_id`, `location_id`) under a lock. Deferred check: every movement of a controlled product has its entry by commit (AC-12). Counter sales of controlled products are rejected (they require a prescription). Prints per drug per location in `entry_no` order (OPEN-5 interim). |

**Inventory (slice 2; receiving and counts in slice 4)**

| Table | Columns | Keys and rules |
|---|---|---|
| `product` [mutable] | `kind` drug, consumable, retail, `name_az?`, `name_ru?`, `name_en?`, `sku?`, `stock_unit` (ml, tablet, piece, gram, ampoule), `pack_size numeric?` (stock units per pack), `strength?`, `concentration numeric?`, `concentration_unit?`, `is_controlled bool`, `requires_prescription bool`, `min_stock numeric?`, `current_price_minor minor_units` (per stock unit), `currency`, `active bool`, `notes?` | At least one name. A controlled product has `requires_prescription`. Price changes never touch past invoices (lines snapshot). |
| `service` [mutable] | `name_az?`, `name_ru?`, `name_en?`, `category` consultation, procedure, lab, grooming, boarding, other, `price_minor minor_units`, `currency`, `default_duration_min int?`, `requires_consent_scope?` surgery, anaesthesia, euthanasia, procedure, `active bool` | |
| `stock_location` [mutable] loc | `name`, `kind` cabinet, fridge, counter, store, `active bool` | |
| `lot` [mutable] | `product_id →`, `lot_number`, `expiry_on date`, `received_at`, `cost_per_unit_minor minor_units?`, `currency`, `supplier?`, `stock_location_id →`, `quantity_on_hand numeric` (cached), `status` active, exhausted, quarantined | Unique (`product_id`, `lot_number`, `stock_location_id`). Check `quantity_on_hand >= 0`. The practice role has no UPDATE grant on `quantity_on_hand`; only the movement trigger changes it. |
| `stock_movement` [append only] loc | `lot_id →`, `quantity_delta numeric` (not zero), `kind` receipt, dispense, sale, administration, adjustment, count, return, write_off, `reason?`, `dispense_event_id? →`, `administration_id? →`, `invoice_line_id? →` (sales and returns), `goods_receipt_line_id? →` (slice 4), `stock_count_line_id? →` (slice 4), `occurred_at` | Check: the reference matching the kind is set, and only that one; partial unique on each reference. Trigger `apply_stock_movement()` adds the delta to the lot under a row lock; a result below zero raises `vetora.stock_below_zero`, so two dispenses cannot oversell one lot. |
| `goods_receipt` [mutable] loc (slice 4) | `supplier?`, `document_number?`, `received_at`, `received_by →`, `note?` | |
| `goods_receipt_line` [append only] (slice 4) | `goods_receipt_id →`, `product_id →`, `lot_id →` (the lot it creates), `quantity numeric`, `cost_per_unit_minor?` | Deferred check: one receipt movement references it. |
| `stock_count` [frozen by status] loc (slice 4) | `stock_location_id →`, `counted_at`, `counted_by →`, `status` open, closed, `note?` | Deferred check on close: every line whose `counted` differs from `expected` has its adjustment movement. |
| `stock_count_line` [frozen with count] (slice 4) | `stock_count_id →`, `lot_id →`, `expected numeric`, `counted numeric` | |

**Billing and Payments (slice 1; receipts and day close in slice 3; estimates in slice 8)**

| Table | Columns | Keys and rules |
|---|---|---|
| `invoice` [frozen by status] loc | `number text?` (gapless per practice, taken from `invoice_number_seq` at issue), `client_id? →`, `patient_id? →`, `encounter_id? →`, `admission_id? →` (slice 8), `boarding_stay_id? →` (slice 10), `appointment_id? →` (slice 5), `estimate_id? →` (slice 8), `status` draft, issued, void, discarded, `issued_at?`, `void_reason?`, `replaced_by_invoice_id? →`, `currency` | Needs neither patient nor encounter (BL-1). Frozen at issue; later only `status` to void, `replaced_by_invoice_id`. Deferred checks at issue: exactly one charge `ledger_entry` equal to the sum of its live lines; every `sale` line has its movement; every line for a service with a consent scope has a current consent; a `client_id` null invoice is fully allocated in the same transaction. At void: a reversing ledger entry and reversing allocations exist. Over estimate is derived (the invoice total against the latest approval of its estimate), never stored. |
| `invoice_line` [set once] | `invoice_id →`, `kind` service, dispense, sale, administration, boarding_night, lab_test, other, `service_id? →`, `product_id? →`, `lot_id? →` (sales), `dispense_event_id? →`, `administration_id? →`, `lab_order_id? →` (slice 9), `description_az?`, `description_ru?`, `description_en?` (snapshots), `quantity numeric`, `unit_price_minor minor_units`, `total_minor minor_units`, `tax_rate numeric?` (null until OPEN-7 and VAT are answered), `removed_at?` (set once, draft invoices only), `sort int` | Partial unique on `dispense_event_id`, `administration_id`, `lab_order_id` (charged once). A removed line is excluded from totals; nothing is removed after issue. |
| `ledger_entry` [append only] | `client_id? →`, `kind` charge, charge_reversal, payment, refund, adjustment, opening_balance, write_off, `amount_minor minor_units` (signed: a charge is positive, a payment negative), `currency`, `invoice_id? →`, `payment_id? →`, `note?`, `occurred_at`, `import_batch_id?` (slice 7) | Check per kind: charge and charge_reversal reference an invoice, payment and refund a payment. View `client_balance(client_id, balance_minor, currency)` sums rows with a client (BL-6); anonymous rows are excluded. |
| `payment` [append only] loc | `client_id? →`, `method` cash, card, transfer, `amount_minor minor_units` (negative is a refund), `currency`, `occurred_at`, `business_date date`, `received_by →`, `note?` | Deferred check: one ledger entry of kind payment or refund references it. Trigger: rejected when a `cash_day_close` exists for its `location_id` and `business_date`. |
| `payment_allocation` [append only] | `payment_id →`, `invoice_id →`, `amount_minor minor_units` (negative reverses), `reverses_allocation_id? →` | Deferred check: per invoice the allocation sum stays between zero and the invoice total; per payment it stays within the payment amount; the handler locks the invoice row first. |
| `fiscal_receipt` [set once] loc (slice 3) | `payment_id →`, `number`, `issued_at`, `amount_minor minor_units`, `currency`, `channel?`, `note?`, `replaces_fiscal_receipt_id? →`, `status` current, replaced (set once) | One current receipt per payment (partial unique). The clinic's cash register issues it; vetora records it (BL-4, OPEN-7). A correction is a new row that replaces the old one. |
| `estimate` [frozen by status] loc (slice 8) | `patient_id →`, `client_id →`, `encounter_id? →`, `admission_id? →`, `supersedes_estimate_id? →`, `status` draft, presented, approved, declined, expired, superseded, `presented_at?`, `total_minor minor_units`, `currency`, `valid_until date?` | Frozen when presented; a change of scope is a new estimate that supersedes it (BL-3). |
| `estimate_line` [frozen with estimate] (slice 8) | `estimate_id →`, `kind`, `service_id? →`, `product_id? →`, `description_az?`, `description_ru?`, `description_en?`, `quantity numeric`, `unit_price_minor`, `total_minor`, `sort int` | |
| `estimate_approval` [append only] (slice 8) | `estimate_id →`, `approved_at`, `approved_by_name`, `ownership_id? →`, `amount_minor minor_units`, `note?` | |
| `cash_day_close` [append only] loc (slice 3) | `business_date date`, `expected_cash_minor` (the day's cash payments at that location), `counted_cash_minor`, `card_total_minor`, `transfer_total_minor`, `difference_minor`, `closed_by →`, `closed_at`, `note?` | Unique (`location_id`, `business_date`). Closing locks the day for new payments. |

**Scheduling and Resources (slice 5)**

| Table | Columns | Keys and rules |
|---|---|---|
| `resource` [mutable] loc | `kind` room, cage, table, provider, `name`, `staff_member_id? → staff_member` (providers), `active bool` | Owned by scheduling; claimed by appointments, admissions, and boarding (RS-1). |
| `appointment_type` [mutable] | `name_az?`, `name_ru?`, `name_en?`, `duration_min int`, `required_resource_kinds text[]`, `category int?` (1 to 4, the design system's calendar colours), `needs_patient bool`, `active bool` | Type decides duration and resources (RS-2). Default types seeded by a slice 5 data migration. |
| `appointment` [mutable] loc | `client_id →`, `patient_id? →`, `appointment_type_id →`, `starts_at`, `ends_at`, `status` unconfirmed, confirmed, waiting, in_progress, completed, cancelled, no_show (the design system's seven states), `reason?`, `notes?` | Check `ends_at > starts_at`. Separate from encounters (SC-1). Deferred check: a cancelled or no show appointment has no active booking. |
| `resource_booking` [mutable] | `resource_id →`, `period tstzrange`, `claimant_kind` appointment, admission, boarding_stay, `claimant_id uuid`, `status` active, cancelled | Exclusion constraint: `resource_id` equal and `period` overlapping, where `status = 'active'` (RS-1). An admission books an open ended period from `admitted_at` and the discharge handler closes it. Cancel by status, never delete. |
| `arrival` [mutable] loc | `client_id →`, `patient_id? →`, `appointment_id? →`, `assigned_to_id? → staff_member` (the vet the walk in waits for), `arrived_at`, `kind` booked, walk_in, emergency, `priority int`, `status` waiting, in_room, done, left, `called_at?`, `called_by? →` | The waiting room is a query over today's arrivals; an arrival moves its appointment to waiting. |

**Hospitalization (slice 8)**

| Table | Columns | Keys and rules |
|---|---|---|
| `admission` [frozen by status] loc | `patient_id →`, `client_id →`, `admitting_encounter_id →`, `cage_booking_id → resource_booking`, `admitted_at`, `discharged_at?`, `status` admitted, discharged, died, `reason?`, `discharge_summary?`, `discharged_by? →` | Its own aggregate, not a long encounter (HS-1); it books a cage, never owns it (HS-4). Deferred check at discharge or death: no active treatment order and the cage booking is closed. |
| `treatment_order` [mutable] | `admission_id →`, `kind` drug, fluid, feeding, observation, procedure, `product_id? →`, `service_id? →` (prices procedures and observations, HS-3), `dose_amount numeric?`, `dose_unit?`, `route?`, `instructions?`, `starts_at`, `interval_minutes int?`, `explicit_times jsonb?`, `ends_at?`, `ordered_by →`, `status` active, stopped, completed, `stopped_at?`, `stopped_by? →` | Stopping marks its pending due rows cancelled. |
| `treatment_due` [set once] | `treatment_order_id →`, `due_at`, `cancelled_at?` (set once) | Unique (`treatment_order_id`, `due_at`). Generated when the order is created or changed. Its outcome is its `administration` row; overdue is derived (`due_at` past, no administration, not cancelled) and settled by a person at handover (HS-2). |
| `handover` [append only] loc | `from_staff_id →`, `to_staff_id →`, `occurred_at`, `note?` | A recorded event, not a report (HS-5). |
| `handover_note` [append only] | `handover_id →`, `admission_id →`, `note` | |

**Non clinical services (slice 10)**

| Table | Columns | Keys and rules |
|---|---|---|
| `boarding_stay` [frozen by status] loc | `patient_id →`, `client_id →`, `cage_booking_id → resource_booking`, `starts_on date`, `ends_on date`, `nightly_rate_minor minor_units`, `currency`, `status` booked, checked_in, checked_out, cancelled, `checked_in_at?`, `checked_out_at?`, `notes?` | Shares the cage booking mechanism with admissions (RS-1). Checkout writes one `boarding_night` invoice line per night and closes the booking (deferred check). |
| `boarding_schedule_item` [mutable] | `boarding_stay_id →`, `kind` feeding, medication, `product_id? →`, `instructions`, `times jsonb` (times of day), `active bool` | Outside the clinical record on purpose (domain.md §6.6). |
| `boarding_schedule_log` [append only] | `boarding_schedule_item_id →`, `due_at`, `status` done, refused, missed, `occurred_at`, `performed_by →`, `note?` | |
| `grooming_note` [mutable] | `appointment_id → !`, `groomer_id → staff_member`, `notes?` | Grooming is an appointment plus services on an invoice; photos attach through `file.appointment_id`. |

**Diagnostics (slice 9)**

| Table | Columns | Keys and rules |
|---|---|---|
| `lab_test` [mutable] | `code !`, `name_az?`, `name_ru?`, `name_en?`, `unit?`, `specimen?`, `fulfilment` in_house, send_out, `service_id? →`, `active bool` | |
| `reference_range` [mutable] | `lab_test_id →`, `species_id →`, `sex?`, `age_min_months int?`, `age_max_months int?`, `low numeric?`, `high numeric?` | Keyed by species (PT-3). |
| `lab_order` [mutable] loc | `patient_id →`, `encounter_id? →`, `admission_id? →`, `ordered_by →`, `ordered_at`, `status` ordered, in_progress, resulted, cancelled | Charged through `invoice_line.lab_order_id`. |
| `lab_order_test` [append only] | `lab_order_id →`, `lab_test_id →` | Unique pair. |
| `lab_result` [set once] | `lab_order_id →`, `lab_test_id →`, `value_numeric?`, `value_text?`, `unit?`, `flag?` low, normal, high, `reference_range_id? →`, `resulted_at`, `entered_by →`, `acknowledged_at?` (set once), `acknowledged_by? →` (set once) | A result not acknowledged after its encounter closed is a loose end (a query). |

**Preventive Care (slice 6)**

| Table | Columns | Keys and rules |
|---|---|---|
| `preventive_protocol` [mutable] | `species_id →`, `kind` vaccine, deworming, parasite, `product_id? →`, `name`, `first_dose_age_weeks int?`, `interval_days int`, `booster_rule?`, `active bool` | Due dates follow a protocol per species (PT-3). |
| `vaccination_record` [set once] | `patient_id →`, `encounter_id →`, `administration_id → !` (the administration that gave it, with its product and lot), `occurred_at`, `next_due_on date?`, `protocol_id? →`, `certificate_document_id? → issued_document` (set once) | |
| `due_item` [mutable] | `patient_id →`, `kind` vaccine, deworming, parasite, recheck, `protocol_id? →`, `source_encounter_id? →`, `vaccination_record_id? →`, `due_on date`, `status` due, contacted, booked, declined, done, `handled_by? →`, `handled_at?`, `note?` | Reception marks each item contacted, booked, or declined. |

**Documents and files (slice 6)**

| Table | Columns | Keys and rules |
|---|---|---|
| `file` [append only] | `storage_key !`, `content_type`, `size_bytes bigint`, `sha256`, `original_name?`, `kind` photo, lab_pdf, consent_scan, letterhead, document, import, other, `patient_id? →`, `client_id? →`, `encounter_id? →`, `appointment_id? →`, `uploaded_by →`, `uploaded_at` | Bytes live in object storage under the practice's prefix (spec 0001); the row is the record. |
| `issued_document` [append only] | `kind` invoice, receipt, prescription, vaccination_certificate, discharge_summary, visit_summary, consent_form, estimate, drug_register_print, `language lang_code`, `template_version`, `file_id →`, `patient_id? →`, `client_id? →`, `encounter_id? →`, `invoice_id? →`, `prescription_id? →`, `admission_id? →`, `estimate_id? →`, `consent_record_id? →`, `issued_by →`, `issued_at` | A draft print stores nothing; an issued document is stored once and never rendered again (spec 0001). |

Not modelled yet, on purpose: Client Communication tables (OPEN-9), the `domain_event` outbox (spec 0001, with the first asynchronous consumer), imaging studies (deferred), purchase orders (receiving covers slice 4), and the sign in tables in `control` (slice 1, Better Auth).

### State transitions

- `encounter`: draft → finalised (veterinarian only, current care relationship) · draft → discarded (only with nothing issued under it). Finalised never changes; amendments append.
- `care_relationship`: current (open, not lapsed) → lapsed by time → current again when the next finalised encounter extends `lapses_at` · open → ended (explicit, set once).
- `prescription`: draft → issued → cancelled. Issued never changes except to cancelled.
- `invoice`: draft → issued → void (reversing ledger entry and allocations, optional replacement invoice) · draft → discarded.
- `estimate`: draft → presented → approved | declined | expired | superseded (by a new estimate).
- `appointment`: unconfirmed → confirmed → waiting → in_progress → completed · any open state → cancelled · confirmed or unconfirmed → no_show; cancelled and no_show release the bookings.
- `arrival`: waiting → in_room → done · waiting → left.
- `resource_booking`: active → cancelled; an admission's open ended period is closed at discharge.
- `admission`: admitted → discharged | died (orders stopped, cage released).
- `treatment_order`: active → stopped | completed. `treatment_due`: open → administered (an `administration` row) | cancelled.
- `boarding_stay`: booked → checked_in → checked_out (nights charged) · booked → cancelled.
- `lab_order`: ordered → in_progress → resulted · ordered or in_progress → cancelled.
- `due_item`: due → contacted | booked | declined | done (any order; done is final).
- `fiscal_receipt`: current → replaced. `stock_count`: open → closed (adjustment movements written). `import_batch`: preview → applied → reverted. `lot`: active → exhausted (balance reaches zero) | quarantined.

### Interface surface

This feature has no HTTP endpoints; the API's request context and routes arrive with slice 1. Its interface is three commands in `apps/api`, the Drizzle schema modules, and the database objects every slice reuses.

| Interface | Kind | Key inputs | Key outputs | Runs as | Key errors |
|---|---|---|---|---|---|
| `migrate` | command (`node dist/migrate.js`) | `DATABASE_URL_MIGRATOR`; optional `--practice <slug>` to limit; `--dry-run` | applies the control set, then the practice set to every registered schema in registry order (`search_path` and `migrationsSchema` per schema, one transaction per schema), runs the grants pass for that schema's role, logs each result | `vetora_migrator`, one direct connection, one advisory lock | lock held by another run → exit 2; a schema fails → stop, exit 1, the others untouched |
| `provision-practice` | command | `--slug`, `--name`, `--owner-user-id`, `--owner-name`, `--location-name`, `--time-zone` (default Asia/Baku), `--languages` (default az,ru) | in order, each step idempotent and under the migrate lock: registry row (status provisioning) → `p_<id>_role` and its membership for `vetora_app` → schema owned by the migrator → practice set → grants pass → `practice_settings`, the default `location`, the owner's `staff_member` row (written with `app.actor_id` = the owner) → status active; prints the practice id | `vetora_migrator` (role creation needs `CREATEROLE`, granted once by `doadmin` in the infra script) | slug taken by a different practice → exit 1; rerun with the same slug → completes any missing step, exit 0 |
| `db:generate` | command (`drizzle-kit generate --config …`) | the control or practice config; `--custom` for hand written SQL | a new migration folder under `apps/api/drizzle/{control,practice}/` | developer | out of order migration files are rejected by CI (spec 0001) |
| Drizzle schema modules | code | `apps/api/src/modules/<context>/schema.ts` per bounded context; `src/platform/db/practice-schema.ts` and `control-schema.ts` gather them for `drizzle-kit` | typed tables for the module's own code | | a module importing another module's schema file is a lint error (chosen by `/audit`) |
| Request transaction (slice 1) | code | practice id from the path, staff id from the session | `SET LOCAL ROLE p_<id>_role`, `SET LOCAL search_path = p_<id>, ext`, `set_config('app.actor_id', …, true)` | `vetora_app` through the pooler | wrong practice → permission denied, never another practice's rows |
| `client_balance` | view | | `client_id`, `balance_minor`, `currency` | practice role | |
| `audit_row()` | trigger function (runs as owner) | `app.actor_id`, `session_user`, `OLD`, `NEW` | an `audit_event` row | | raises `vetora.no_actor` |
| `apply_stock_movement()` | trigger function (runs as owner) | a `stock_movement` row | updates `lot.quantity_on_hand` under a row lock | | raises `vetora.stock_below_zero` |
| `record_controlled_entry(movement_id, signed_by)` | function (runs as owner) | a movement of a controlled product | the `controlled_drug_entry` row with `entry_no` and `balance_after` per product and location, taken under a lock | practice role has EXECUTE | raises `vetora.not_controlled`, `vetora.already_registered` |
| `next_invoice_number()` | function | | the next gapless number from `invoice_number_seq`, called by the issue handler | practice role has EXECUTE | |
| `set_once()`, `freeze_record()`, `lock_parent()`, `set_updated_at()` | trigger functions | the row and its class | reject disallowed changes; lock the parent `FOR SHARE` on child insert; keep `updated_at` | | raises `vetora.frozen_record`, `vetora.set_once` |
| `assert_*` | deferred constraint triggers (checked at commit) | the rows written in the transaction | refuse the commit when a dispense, administration, sale line, count close, issued invoice, void, payment, allocation, discharge, checkout, cancelled appointment, or controlled movement lacks its companion rows | | raises `vetora.incomplete_<rule>` naming the missing row |

### Value sourcing

| Action | Value produced or displayed | Source |
|---|---|---|
| Any write | `created_by`, `updated_by`, `audit_event.actor_id` | the `app.actor_id` transaction setting (spec 0001 request context, PIN switching later); a migration or import revert as `vetora_migrator` writes `source = migration:<name>` with no actor |
| Any write | `created_at`, `updated_at`, `audit_event.occurred_at` | the database clock (`now()`), never a client value |
| Record an observation, dispense, administration, payment, arrival | `occurred_at` | the staff member's input, checked not in the future and within `practice_settings.backdate_limit_hours` of `now()` (trigger) |
| Record a payment | `business_date` | `occurred_at` converted to `practice_settings.time_zone`, computed by the handler |
| Show a client's debt | `client_balance.balance_minor` | sum of `ledger_entry.amount_minor` for the client (BL-6); anonymous entries excluded |
| Issue an invoice | `number` | `next_invoice_number()`, one gapless sequence per practice |
| Issue an invoice | the charge ledger entry amount | sum of `invoice_line.total_minor` over lines not removed; each line's `total_minor` = `quantity` times `unit_price_minor`, rounded half up to a minor unit |
| Add an invoice line | `description_az`, `description_ru`, `description_en`, `unit_price_minor` | snapshots of the product's or service's three names and its current price per stock unit at the time of the line |
| Print a document | the language | `client.preferred_language` for client documents, offered with the other two in the preview; the signed in person's UI language for screens; `practice_settings.default_language` as the fallback |
| Sell over the counter | `stock_movement.quantity_delta` | the sale line's quantity (negative) against `invoice_line.lot_id`, written by the issue handler |
| Dispense | `stock_movement.quantity_delta`, `lot.quantity_on_hand` | the dispense quantity (negative delta) written by the handler, applied by the trigger to the chosen lot |
| Dispense or administer a controlled drug | `controlled_drug_entry.entry_no`, `balance_after` | the previous entry for that product and location plus the delta, computed by `record_controlled_entry` under a lock |
| Calculate a dose | `dose_per_kg` | the vet's input, defaulted from `product_species_dose` for the product, species, and route; the maximum from the same row is a warning |
| Calculate a dose | `weight_kg`, `result_amount` | the weight observation's value snapshotted; `weight_kg` times `dose_per_kg`, divided by `concentration`; inputs stored beside the result (RX-5) |
| Finalise an encounter or issue a prescription | the care relationship | the open `care_relationship` for the patient and vet (any vet when `delegation_enabled`) whose `lapses_at` is in the future; else a new row inserted by the handler in the same transaction |
| Finalise an encounter | `care_relationship.lapses_at` | `finalised_at` plus `practice_settings.care_relationship_lapse_months`, moved later by the handler |
| Charge a procedure given on the ward | the price | `treatment_order.service_id` (or `product_id` for a drug) snapshotted onto the administration's invoice line |
| Book a resource | `resource_booking.period` | `appointment.starts_at` and `ends_at` (from `appointment_type.duration_min`); for an admission `[admitted_at, open)` closed with `discharged_at`; for boarding the stay's dates in the practice time zone |
| Show the waiting room | the queue order | `arrival.priority` then `arrived_at`, filtered by `location_id` and, when set, `assigned_to_id` |
| Generate due rows for an order | `treatment_due.due_at` values | `treatment_order.starts_at`, `interval_minutes` or `explicit_times`, `ends_at`, interpreted in `practice_settings.time_zone` |
| Show the ward board | overdue orders | `treatment_due` rows with `due_at` past, no `administration`, and `cancelled_at` null |
| Check out a boarding stay | the nightly lines | one `boarding_night` line per night between `starts_on` and `ends_on` at `nightly_rate_minor`, written by the checkout handler |
| Close the day | `expected_cash_minor` | sum of cash `payment.amount_minor` with that `business_date` and `location_id` |
| Next vaccination due | `vaccination_record.next_due_on` | `occurred_at` plus the matching `preventive_protocol.interval_days` for `patient.species_id` |
| Flag a lab result | `lab_result.flag` | `value_numeric` against the `reference_range` for the patient's species, sex, and age at `resulted_at` |
| Flag an invoice over its estimate | the flag | invoice total compared with the latest `estimate_approval.amount_minor` of `invoice.estimate_id`, computed at read time |
| Require consent | which lines need it | `service.requires_consent_scope` on the line's service; satisfied by a `consent_record` of that scope for the patient with `withdrawn_at` null |
| Show a time | the wall clock time | `timestamptz` converted with `practice_settings.time_zone` |
| Resolve the tenant | the practice schema and role | `control.practice.schema_name` and `role_name` by practice id from the API path (spec 0001), set per transaction |
| Provision a practice | `practice.id`, `schema_name`, `role_name` | the sign in organisation id when it exists, else a new UUID v7; `p_` plus the id, and that plus `_role` |

### Key invariants

Each rule names its mechanism; the app also validates, but the database is the guarantee.

- Finalised encounters, issued prescriptions and invoices, presented estimates, and closed stock counts are frozen (triggers), and corrections append (CR-1, RX-4, BL-3, BL-6, IN-6). A child row insert locks its parent, so no row slips in beside a concurrent freeze.
- Append only tables: `encounter_amendment`, `clinical_observation`, `dose_calculation`, `dispense_event`, `administration`, `stock_movement`, `goods_receipt_line`, `ledger_entry`, `payment`, `payment_allocation`, `estimate_approval`, `cash_day_close`, `handover`, `handover_note`, `boarding_schedule_log`, `lab_order_test`, `file`, `issued_document` (grants: INSERT and SELECT only). Function written: `audit_event`, `controlled_drug_entry` (SELECT only).
- Set once columns: `ownership.valid_to`, `care_relationship.ended_at` and `ended_by` (and `lapses_at` only later), `consent_record.withdrawn_at`, `lab_result.acknowledged_at` and `acknowledged_by`, `vaccination_record.certificate_document_id`, `invoice_line.removed_at`, `treatment_due.cancelled_at`, `fiscal_receipt.status`, `practice_settings.go_live_at` (trigger: only null to a value).
- No DELETE for the practice role on any table (grants). Records retire by status. The one delete path is an import revert by the migrator before go live, audited.
- Every practice role write carries an actor (`vetora.no_actor`).
- Every transaction that dispenses, administers, sells, receives, counts, issues, voids, pays, allocates, discharges, checks out, or cancels an appointment leaves its companion rows in place, or it does not commit (deferred constraint triggers, AC-3, AC-12).
- One current owner per patient; one open care relationship per patient and vet; no overlapping active bookings per resource (exclusion constraints and partial uniques).
- A lot's balance never drops below zero (check plus row lock); only the movement trigger changes it (column grant).
- A dispense needs an issued prescription, a matching active unexpired lot, and stays within the prescribed quantity (trigger). A counter sale never moves a controlled product (trigger).
- Money is `minor_units` with a `currency_code`; quantities are in the product's `stock_unit`; languages are `lang_code`; `occurred_at <= now()`; `valid_to > valid_from`; `ends_at > starts_at` (checks).
- `encounter.finalised_by` and `prescription.prescriber_id` have role veterinarian (triggers reading `staff_member.roles`).
- An admitting encounter never carries `admission_id` (trigger).
- Only `control`, `ext`, and `p_*` schemas hold objects; the app role reads a practice only after `SET LOCAL ROLE` (AC-11).
- Cross context foreign keys exist (an invoice line may reference a lot) but modules read other contexts only through their public interfaces (spec 0001; lint rule chosen by `/audit`).

### Security model

- **Roles** (spec 0001, refined here): `vetora_migrator` owns every schema, table, and function, holds `CREATEROLE`, and runs `migrate` and `provision-practice`; one no login role per practice holds that schema's grants by table class; `vetora_app` is a member of every practice role (`INHERIT FALSE`, `SET TRUE`) and holds no table grant of its own; `vetora_backup` gets SELECT on everything for dumps. `CONNECT` and `TEMP` are revoked from `PUBLIC` and from `vetora_app` (no shadowing of tables through temporary ones). `doadmin` is used only by the infra script that creates the roles and the database.
- **Grants pass**: after migrating a schema, `migrate` applies the table classes from `src/platform/db/table-classes.ts` (each module registers its tables) to that practice's role as GRANT and REVOKE statements, including column level grants (no UPDATE on `lot.quantity_on_hand`), and fails if a practice table lacks the audit trigger or a class. A new table can never ship with wider rights than its class.
- **Owner run functions**: `audit_row`, `apply_stock_movement`, `record_controlled_entry`, and the freeze and set once triggers are `SECURITY DEFINER`, owned by `vetora_migrator`, with `search_path` pinned to `pg_catalog` and tables addressed by `TG_TABLE_SCHEMA`, so a practice role cannot forge an audit or register row and cannot bypass the writers.
- **Isolation**: one schema and one role per practice; the request context switches role and search path per transaction (slice 1). A fully qualified query against another practice fails with permission denied (AC-11). Cross practice reads (reporting, the owner app) run in the worker or admin scripts under the migrator or a reporting role, never by switching a request's practice.
- **Personal data** (Azerbaijan's Law on Personal Data applies; spec 0001): the columns that hold it are `client.*_name`, `organisation_name`, `tax_id`, `contact_person`, `client_contact.value` and `value_normalised`, `consent_record.granter_name`, `estimate_approval.approved_by_name`, `staff_member.display_name`, `practice_settings` identity fields, and every free text column (`notes`, `anamnesis`, `status_praesens`, `diagnosis_text`, `plan`, `reason`, `note`, `instructions`). They never appear in URLs, logs, or Sentry events (spec 0001's scrubbing rules). `audit_event.changed` holds new values, so the audit table is covered by the same backup encryption and access rules as the tables it mirrors.
- **Audit is mandatory**: every practice table has the audit trigger; the grants pass fails the migration otherwise.
- **Encryption**: managed Postgres encrypts at rest; dumps are encrypted (spec 0001); no column level encryption now.

### Configuration required

No new variables. The commands use spec 0001's `DATABASE_URL_MIGRATOR` (migrate, provision, grants) and the local Docker Compose Postgres from the scaffold. `app.actor_id` is a per transaction Postgres setting, not an environment variable. The infra script grants `CREATEROLE` to `vetora_migrator` once.

### Critical test scenarios

- Happy path: provision two practices locally, migrate, switch to each practice's role, insert a client and patient in each with an actor set, read each back, and confirm the audit rows name the actor, verifies **AC-8**, **AC-10**, **AC-11**.
- Isolation: as `vetora_app` with no role switch, `select * from p_a.client` fails with permission denied; after `SET LOCAL ROLE` for practice A, `select * from p_b.client` fails with permission denied, verifies **AC-11**.
- Failure case: in one transaction insert a dispense event and commit without a stock movement, expect `vetora.incomplete_dispense` and no rows; insert dispense, movement, and line for a quantity above the lot balance, expect `vetora.stock_below_zero`; then the full set within balance commits and the lot balance drops, verifies **AC-3**.
- Failure case: finalise an encounter, then UPDATE its `plan` through the practice role, expect `vetora.frozen_record`; insert an amendment and read the chart in order, verifies **AC-2**.
- Failure case: finalise an encounter with no care relationship row in the transaction, expect rejection; with the handler's new row, it commits and `lapses_at` is twelve months out, verifies **AC-14**.
- Failure case: insert a second owner row overlapping the first, expect the exclusion error; close the first with `valid_to` and insert again, verifies **AC-5**.
- Failure case: book a cage twice for overlapping periods, expect the exclusion error; cancel the first and book again, verifies **AC-7**.
- Money: issue an invoice (number assigned, charge entry present), record two part payments with allocations, confirm `client_balance` equals charge minus payments, that an allocation above the invoice total is refused at commit, and that UPDATE on a ledger row is denied, verifies **AC-4**, **AC-9**.
- Anonymous sale: issue an invoice with no client and allocations below its total, expect `vetora.incomplete_anonymous_invoice`; fully allocated it commits and never appears in `client_balance`, verifies **AC-4**, **AC-9**.
- Permission: try DELETE on any table through a practice role, expect permission denied; write without `app.actor_id` and with it set to an empty string, expect `vetora.no_actor`; INSERT into `audit_event` or `controlled_drug_entry` directly, expect permission denied, verifies **AC-8**, **AC-9**, **AC-12**.
- Correction safety: record a weight, calculate a dose, record a corrected weight, confirm the dose row still references and snapshots the first weight, and that UPDATE on the first observation is denied, verifies **AC-6**.
- Register: dispense a controlled product with its movement and `record_controlled_entry`, confirm one entry with `entry_no` 1 and the running balance; commit a controlled movement without the function call, expect `vetora.incomplete_register`, verifies **AC-12**.
- Checks: insert `preferred_language = 'tr'`, an `occurred_at` one hour ahead, and an ownership with `valid_to` before `valid_from`, expect check violations, verifies **AC-13**.
- Migration order: run `migrate` with a practice schema deliberately one migration behind, confirm it catches up in order and the grants pass runs; run it twice and confirm the second run changes nothing; run `provision-practice` twice with one slug, verifies **AC-10**.

## Build plan

Tracer bullet: this feature ships the shared base and proves the whole chain (two migration sets, the extensions schema, provisioning with a role per practice, grants, triggers, deferred checks, isolation) on a thin set of tables. Every later slice adds its own context's tables from the sketch above as its first task, using the same conventions, so the target is realised incrementally and nothing is built before it is used. This feature's own verify covers AC-1 and AC-8 to AC-13; AC-2 to AC-7 and AC-14 are proven when the slice that builds their tables lands, with the scenarios above.

1. Create the `control` migration set with `control.practice`, the `ext` schema and its extensions (`btree_gist`, `pg_trgm`, `unaccent` with an immutable wrapper), and the practice migration set with the domains (`minor_units`, `currency_code`, `lang_code`) and the shared functions (`set_updated_at`, `audit_row`, `set_once`, `freeze_record`, `lock_parent`, the `assert_*` constraint trigger helpers), all owned by `vetora_migrator` with pinned search paths, satisfies **AC-8**, **AC-9**, **AC-13**
2. Add the foundation tables to the practice set: `practice_settings`, `location`, `staff_member`, `audit_event`, with their checks, indexes, and the audit trigger attached, satisfies **AC-1**, **AC-8**
3. Write `src/platform/db/table-classes.ts` and the grants pass (per class GRANT and REVOKE on the practice role, column level grants, audit trigger presence check, no DELETE anywhere, `audit_event` SELECT only), satisfies **AC-9**, **AC-12**
4. Build the `migrate` command: advisory lock, control set first, then every registered practice schema in registry order with `search_path` and `migrationsSchema` set per schema, one transaction per schema, the grants pass after each, clear exit codes, satisfies **AC-10**
5. Build the `provision-practice` command with its idempotent steps in order (registry row, role and membership, schema, practice set, grants, settings and default location and owner written as the owner, status active), satisfies **AC-10**, **AC-11**
6. Prove isolation and the rules on the local database: provision two practices, run the critical test scenarios the foundation tables allow (role switch and permission denied, actor required, no DELETE, audit rows, migration and provisioning reruns), and write the results into `verify.md` for `/check verify`, satisfies **AC-8**, **AC-10**, **AC-11**
7. Add the Drizzle schema module skeleton: `src/modules/<context>/schema.ts` for the thirteen contexts (empty where the slice has not arrived), the `practice-schema.ts` and `control-schema.ts` collections, and the two `drizzle-kit` configs, satisfies **AC-1**

Per slice table sets, designed here and built by each slice's own feature as its first task (all satisfy **AC-1**; the rule each carries is in brackets):

- Slice 1, first visit: `client`, `client_contact`, `species` (seeded by migration), `breed`, `patient`, `ownership` (**AC-5**), `patient_problem`, `care_relationship` (**AC-14**), `encounter`, `encounter_diagnosis`, `encounter_amendment` (**AC-2**), `clinical_observation` (**AC-6**), `service`, `invoice` with `invoice_number_seq` and `next_invoice_number()`, `invoice_line`, `ledger_entry`, `client_balance` (**AC-4**), `payment`, `payment_allocation`; the control sign in tables arrive with it, configured to issue UUID v7 ids.
- Slice 2, medicines: `product`, `product_species_dose`, `stock_location`, `lot`, `stock_movement` with `apply_stock_movement()` (**AC-3**), `prescription`, `prescription_line`, `dose_calculation` (**AC-6**), `dispense_event` (**AC-3**), `administration`, `controlled_drug_entry` with `record_controlled_entry()` (**AC-12**); forward columns `invoice_line.product_id`, `lot_id`, `dispense_event_id`, `administration_id`.
- Slice 3, money at the desk: `fiscal_receipt`, `cash_day_close`, `payment.business_date` lock trigger.
- Slice 4, stock and counter: `goods_receipt`, `goods_receipt_line`, `stock_count`, `stock_count_line`; forward columns `stock_movement.goods_receipt_line_id`, `stock_count_line_id`; counter sales reuse `invoice` with `sale` lines.
- Slice 5, bookings: `resource`, `appointment_type` (defaults seeded by migration), `appointment`, `resource_booking` (**AC-7**), `arrival`; forward columns `encounter.appointment_id`, `encounter.arrival_id`, `invoice.appointment_id`.
- Slice 6, records and documents: `file`, `issued_document`, `preventive_protocol`, `vaccination_record`, `due_item`; forward columns `patient.photo_file_id`, `practice_settings.letterhead_file_id`; the search indexes (`pg_trgm`) on client and patient names.
- Slice 7, pilot go live: `import_batch`; forward columns `import_batch_id` on `client`, `patient`, `ownership`, `ledger_entry`; the import revert path.
- Slice 8, стационар: `estimate`, `estimate_line`, `estimate_approval`, `consent_record`, `admission`, `treatment_order`, `treatment_due`, `handover`, `handover_note`; forward columns `encounter.admission_id`, `clinical_observation.admission_id`, `administration.treatment_due_id`, `invoice.admission_id`, `invoice.estimate_id`.
- Slice 9, lab: `lab_test`, `reference_range`, `lab_order`, `lab_order_test`, `lab_result`; forward column `invoice_line.lab_order_id`.
- Slice 10, grooming and boarding: `grooming_note`, `boarding_stay`, `boarding_schedule_item`, `boarding_schedule_log`; forward column `invoice.boarding_stay_id`.

## Consequences

**Positive**:
- The hardest rules (append only records, dispensing and stock in one transaction, one owner at a time, no double booking, who did what, no cross practice read) hold even when application code is wrong, and `/check verify` can prove each one with a query.
- Every write is in application code, in plain sight and testable; the database only refuses, maintains derived columns, and logs.
- Every slice starts from a designed table set with the conventions already in place, so slices add tables rather than rework them.
- A practice schema is self contained (settings, locations, staff mirror, audit, data) behind its own role, so one schema dump is a complete clinic and a wrong practice id cannot leak data.

**Negative / tradeoffs**:
- More database objects to maintain: domains, owner run functions, deferred constraint triggers, a grants pass, exclusion constraints, one role per practice. A trigger bug is a production bug; each needs a test in `verify.md` and later `/test`.
- Deferred checks surface at commit, not at the failing statement; handlers must treat a commit failure as a first class error and surface which companion row was missing (the exception name says).
- A role per practice is a cluster level object: provisioning needs `CREATEROLE`, dumps and restores must carry the role, and a restore into another cluster recreates it.
- Drizzle 1.0 is a release candidate (spec 0001); migration tooling may change before 1.0.0 and the custom SQL migrations are hand maintained.
- Audit rows and an `updated_at` touch per change add writes; drafts autosave at most every 30 seconds to keep the audit table in check. Revisit if a table reaches millions of rows.
- Three name columns per catalog row and three description snapshots per line make a fourth language a migration. Chosen over JSON for typed, indexable, correctly collated names.
- `treatment_due` rows are generated ahead of time, so changing an order must cancel and regenerate pending rows.

**Neutral**:
- Audit rows store new values, so the audit table holds personal and clinical data under the same protection as the tables it mirrors (Azerbaijan's personal data law applies; spec 0001).
- Reference data (species, appointment types) is seeded per practice by data migrations run as the migrator, so existing practices receive it and the audit names the migration.
- The merge signals in domain.md §6.6 (Client and Patient as one module, boarding splitting out) stay watchable: the tables are separate, the modules can merge without a migration.

## Follow-up

- [ ] OPEN-5 (controlled drug register) with your lawyer before slice 2 ships: confirm per administration entries, one signature, 7 year retention, and whether the balance is kept per location; the function and columns are easy to relax, hard to retrofit.
- [ ] OPEN-7 and VAT with your accountant before slice 3: whether `invoice_line.tax_rate` is needed, whether prices stay gross, how a corrected receipt is recorded, and whether a receipt is per payment as modelled.
- [ ] Interviews (OPEN-10, OPEN-11): confirm the four note sections and the species list before slice 1 seeds them; the `species.clinically_supported` flag and `note_format` make either answer a data change, not a migration.
- [ ] First visit spec (scope feature 5): the request context that sets the practice role, `search_path`, and `app.actor_id`; the sign in tables in `control` configured to issue UUID v7 ids; the `staff_member` sync with `roles` as an array; the handler that creates or renews the care relationship.
- [ ] Spec 0001 says `doadmin` is used only by provisioning; this spec runs schema provisioning as `vetora_migrator` with `CREATEROLE` and leaves `doadmin` to the infra script. Reconcile the wording in 0001 at the scaffold.
- [ ] `/audit`: the lint rule that keeps a module from importing another module's `schema.ts`, the convention for handlers writing companion rows and reading commit failures, and the test harness for trigger and constraint behaviour.
- [ ] Slice 6: the `pg_trgm` and `unaccent` search indexes on client and patient names, the `domain_event` outbox when the first asynchronous consumer appears (spec 0001).
- [ ] Before a second location: decide price overrides per location (`price` rows) and per location stock views; the columns are ready, the tables are not.
- [ ] Watch the domain.md §6.6 merge signals: if no rule ever needs Client and Patient apart, merge the modules; if boarding medication needs veterinary supervision, split boarding out.

## References

**Project sources** (verifiable, in this repo):
- `docs/domain.md`: §6 bounded contexts, §7 glossary (table names), §8 invariants (CR, PT, RX, HS, SC, RS, BL, IN), §9 domain events, §10 cross cutting concerns, §12 OPEN register
- `docs/specs/0001-stack-architecture/index.md`: tenancy and data topology, roles, migrations, request context, API conventions, documents, configuration
- `docs/scope/scope.md`: feature 3's intent and done when; the entities each slice needs
- The vetora design system (Claude Design System artifact, linked from spec 0001): the seven appointment states, four calendar categories, the five print documents, three languages
- `docs/.agent-cache/research/scaffold-doc-check.md`: Drizzle 1.0 release candidate migration behaviour (one transaction, `search_path`, `migrationsSchema` per schema), DigitalOcean role creation
- The cross check record in `rationale.md`: the sixteen gaps and ten soundness findings this revision closed

**Practices & standards**:
- Append only ledgers for money and legal records; corrections as new entries
- Least privilege database roles; grants derived from a table classification; one role per tenant switched per transaction
- Deferred constraint triggers to verify transactional invariants at commit, with application code doing every write
- Owner run (security definer) functions for rows the application may request but never forge
- Exclusion constraints for resource scheduling and temporal ownership (`btree_gist`)
- Derivations stored with their inputs (a dose keeps its weight); snapshot pricing and names on invoice lines; derived balances computed at read time
- Materialised due rows so a missed event is a fact; outcomes recorded by a person
- Time ordered UUID v7 primary keys; instants in UTC rendered in the practice time zone; calendar facts as dates
- Expand then contract migrations; forward only, applied per schema under a lock; extensions in a shared schema
