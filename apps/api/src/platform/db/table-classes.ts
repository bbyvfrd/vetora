import { getTableName } from 'drizzle-orm'
import { location, practiceSettings } from './platform-tables.js'

/**
 * The table class registry (spec 0002, "Conventions": Table classes; "Security model": Grants pass). Every practice
 * table names its class here, and the grants step (grants.ts) turns the class into the practice role's privileges
 * after each practice migration, so a table never ships with wider rights than its class. A module registers its
 * tables when its schema arrives; the full class table and the presence checks arrive with the grants ticket.
 * control.practice is not here: the control set carries its own grants.
 */
export const TABLE_CLASSES = ['append_only', 'set_once', 'mutable', 'frozen_by_status', 'function_written'] as const

export type TableClass = (typeof TABLE_CLASSES)[number]

export const tableClasses: ReadonlyMap<string, TableClass> = new Map<string, TableClass>([
  [getTableName(practiceSettings), 'mutable'],
  [getTableName(location), 'mutable'],
])
