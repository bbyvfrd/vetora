import { getTableName } from 'drizzle-orm'
import {
  auditEvent,
  breed,
  careRelationship,
  client,
  clientContact,
  clinicalObservation,
  encounter,
  invoice,
  invoiceLine,
  invoiceNumberSeq,
  ledgerEntry,
  location,
  ownership,
  patient,
  practiceSettings,
  service,
  species,
  staffMember,
} from './practice-schema.js'

/**
 * The table class registry (spec 0002, "Conventions": Table classes; "Security model": Grants pass): what the practice
 * role may do in its schema, as data. Every practice table names its class here, a view is listed to be read, a
 * function to be called, and the grants pass (grants.ts) turns the entries into GRANT and REVOKE statements after each
 * practice migration, inside the schema's transaction, refusing the schema when it and this file disagree. So a table
 * never ships with wider rights than its class, and a module's schema.ts and its entries here change in one commit.
 * control.practice is not here: the control set carries its own grants.
 */

/** A practice table's entry: its class, and the column exceptions the class allows. */
export type TableEntry =
  /** INSERT and SELECT: a record is never changed, a correction is a new row (CR-1, RX-4, BL-6). */
  | { class: 'append_only' }
  /**
   * INSERT and SELECT, and UPDATE on the named columns alone (`consent_record.withdrawn_at`); the set_once() trigger
   * lets each go from null to a value once. `movesLater` names an instant that may only move later
   * (`care_relationship.lapses_at`), which the trigger takes as a `later:<column>` argument; `free` names a column that
   * may change while the row lives (`invoice_line.quantity` while its invoice is a draft, lock_parent() freezing it
   * after), which the trigger takes as `free:<column>`.
   */
  | {
      class: 'set_once'
      setOnce: readonly [string, ...string[]]
      movesLater?: readonly string[]
      free?: readonly string[]
    }
  /** INSERT, SELECT, UPDATE, never DELETE: a record retires by status (IN-6). `noUpdate` names columns the role never updates (`lot.quantity_on_hand`, the movement trigger's alone). */
  | { class: 'mutable'; noUpdate?: readonly string[] }
  /** As mutable until the status column reaches its final value; the freeze_record() trigger then refuses every change but the columns it names (and lock_parent() its child rows). */
  | { class: 'frozen_by_status'; noUpdate?: readonly string[] }
  /** SELECT only: the rows come from an owner run function (`audit_row()`, later `record_controlled_entry()`). */
  | { class: 'function_written' }

export type TableClass = TableEntry['class']

export type TableClassRegistry = {
  /** Every table of the practice schema but Drizzle's migrations table, by name. */
  tables: ReadonlyMap<string, TableEntry>
  /** The views the practice role reads (SELECT): `client_balance` arrives with slice 1. */
  views: ReadonlySet<string>
  /**
   * The functions the practice role calls (EXECUTE on every overload of the name): `next_invoice_number` with slice 1,
   * `record_controlled_entry` with slice 2. Trigger functions are not here: a trigger runs its function without EXECUTE.
   */
  functions: ReadonlySet<string>
}

export const tableClassRegistry: TableClassRegistry = {
  tables: new Map<string, TableEntry>([
    [getTableName(practiceSettings), { class: 'mutable' }],
    [getTableName(location), { class: 'mutable' }],
    [getTableName(staffMember), { class: 'mutable' }],
    /** Written only by audit_row(); the practice role reads it (AC-8, AC-9). */
    [getTableName(auditEvent), { class: 'function_written' }],
    // The Client module (#21).
    [getTableName(client), { class: 'mutable' }],
    [getTableName(clientContact), { class: 'mutable' }],
    // The Patient module (#21): species seeded by the species_seed migration, the clinic adding breeds; an ownership
    // period is closed by filling valid_to once (AC-5).
    [getTableName(species), { class: 'mutable' }],
    [getTableName(breed), { class: 'mutable' }],
    [getTableName(patient), { class: 'mutable' }],
    [getTableName(ownership), { class: 'set_once', setOnce: ['valid_to'] }],
    // The Clinical Record module (#22): a care relationship ends once and lapses later with each finalised visit
    // (CR-4); a visit freezes when it is finalised or discarded (CR-1, AC-2).
    [
      getTableName(careRelationship),
      { class: 'set_once', setOnce: ['ended_at', 'ended_by'], movesLater: ['lapses_at'] },
    ],
    [getTableName(encounter), { class: 'frozen_by_status' }],
    // A reading is never changed: a corrected weight is a new row (PT-2, AC-6; #23).
    [getTableName(clinicalObservation), { class: 'append_only' }],
    // The Inventory module (#25): the price list, edited and retired by `active`.
    [getTableName(service), { class: 'mutable' }],
    // The Billing module (#25): the counter only next_invoice_number() advances; an invoice freezes at issue and its
    // lines with it, a draft line's quantity changing and its removal set once; the ledger is never changed (BL-6).
    [getTableName(invoiceNumberSeq), { class: 'function_written' }],
    [getTableName(invoice), { class: 'frozen_by_status' }],
    [
      getTableName(invoiceLine),
      { class: 'set_once', setOnce: ['removed_at'], free: ['quantity', 'total_minor', 'sort'] },
    ],
    [getTableName(ledgerEntry), { class: 'append_only' }],
  ]),
  /** A client's balance, the sum of their ledger rows (BL-6; #25). */
  views: new Set(['client_balance']),
  /** The gapless invoice number, taken by the issue handler (#25). */
  functions: new Set(['next_invoice_number']),
}

/** The table privileges a class can grant; DELETE, TRUNCATE, REFERENCES, and TRIGGER are in none (IN-6). */
export type TablePrivilege = 'INSERT' | 'SELECT' | 'UPDATE'

export type TableGrant = {
  /** The table level privileges. */
  privileges: readonly TablePrivilege[]
  /** The columns a column level UPDATE covers, when the class narrows it: the set once columns, or every column but the noUpdate ones. */
  updateColumns?: readonly string[]
  /** The columns the entry names, which the table must have. */
  namedColumns: readonly string[]
}

/** What an entry grants the practice role on its table (spec 0002, "Conventions": Table classes), given the table's columns. */
export function grantOf(entry: TableEntry, columns: readonly string[]): TableGrant {
  switch (entry.class) {
    case 'append_only':
      return { privileges: ['INSERT', 'SELECT'], namedColumns: [] }
    case 'set_once': {
      const updatable = [...entry.setOnce, ...(entry.movesLater ?? []), ...(entry.free ?? [])]
      return { privileges: ['INSERT', 'SELECT'], updateColumns: updatable, namedColumns: updatable }
    }
    case 'mutable':
    case 'frozen_by_status': {
      const noUpdate = entry.noUpdate ?? []
      if (noUpdate.length === 0) return { privileges: ['INSERT', 'SELECT', 'UPDATE'], namedColumns: [] }
      return {
        privileges: ['INSERT', 'SELECT'],
        updateColumns: columns.filter((column) => !noUpdate.includes(column)),
        namedColumns: noUpdate,
      }
    }
    case 'function_written':
      return { privileges: ['SELECT'], namedColumns: [] }
  }
}

/**
 * The audit log: the one table without the two shared triggers, since the log is not itself audited and carries no
 * standard columns; every other table has both, or the grants pass refuses the schema (IN-1, AC-8; spec 0002,
 * "Security model": Audit is mandatory).
 */
export const AUDIT_LOG_TABLE = getTableName(auditEvent)

/** Drizzle's migrations table, one per schema: the one table of a practice schema outside the registry, read by migrate and granted to no practice role. */
export const MIGRATIONS_TABLE = '__drizzle_migrations'
